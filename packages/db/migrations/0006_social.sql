-- 0006_social: social graph, feed, moderation, thesis evaluation, reputation appeals and
-- notifications (Sprint 6, PRD §9–§10, ADR-0005). $WIF and elections are never referenced here.

-- ---------------------------------------------------------------------------------------------
-- Users: role (set only by the CLI script `pnpm user:role`), one-time handle change (OQ-H-06)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE users
  ADD COLUMN role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'moderator')),
  ADD COLUMN handle_changed_at timestamptz;

-- The API may change only these user columns. role and is_demo are owner-only (CLI and seed).
REVOKE UPDATE ON users FROM suiem_app;
GRANT UPDATE (handle, display_name, status, handle_changed_at) ON users TO suiem_app;

-- ---------------------------------------------------------------------------------------------
-- Profiles: thesis list visibility; follower lists are private by default too (PO: defaults private)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE profiles ADD COLUMN theses_visibility visibility NOT NULL DEFAULT 'private';
ALTER TABLE profiles ALTER COLUMN followers_visibility SET DEFAULT 'private';

-- Theses record whether AI helped (a brief as evidence, or an AI draft). Users can't clear it.
ALTER TABLE theses ADD COLUMN ai_assisted boolean NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------------------------
-- Graph: mutes and blocks
-- ---------------------------------------------------------------------------------------------
CREATE TABLE mutes (
  muter_id    uuid NOT NULL REFERENCES users (id),
  muted_id    uuid NOT NULL REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (muter_id, muted_id),
  CHECK (muter_id <> muted_id)
);

CREATE TABLE blocks (
  blocker_id  uuid NOT NULL REFERENCES users (id),
  blocked_id  uuid NOT NULL REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked ON blocks (blocked_id);

-- ---------------------------------------------------------------------------------------------
-- Posts: labels, server-built attachment (thesis/brief/portfolio snapshot), moderation hide
-- ---------------------------------------------------------------------------------------------
ALTER TABLE posts
  ADD COLUMN sourced boolean NOT NULL DEFAULT false,
  -- Built by the server only (thesis summary, brief sources, allocation percentages).
  ADD COLUMN attachment jsonb,
  ADD COLUMN hidden_at timestamptz,
  ADD COLUMN hidden_reason text CHECK (hidden_reason IN ('spam', 'scam', 'harassment', 'impersonation', 'manipulation', 'undisclosed_sponsorship', 'fraudulent_performance', 'other')),
  -- Posts never default to public: the composer must send a visibility (PO decision).
  ALTER COLUMN visibility DROP DEFAULT;
-- Sponsored is always false in the hackathon build (the UI supports the label).
ALTER TABLE posts ADD CONSTRAINT posts_not_sponsored_yet CHECK (NOT sponsored);
ALTER TABLE posts ADD CONSTRAINT posts_kind_links CHECK (
  (kind <> 'thesis' OR thesis_id IS NOT NULL) AND (kind <> 'research_brief' OR brief_id IS NOT NULL)
);
CREATE INDEX posts_author ON posts (user_id, created_at DESC);
CREATE INDEX posts_entity ON posts (entity_id, created_at DESC) WHERE entity_id IS NOT NULL;

ALTER TABLE comments
  ADD COLUMN hidden_at timestamptz,
  ADD COLUMN hidden_reason text;
CREATE INDEX comments_post ON comments (post_id, created_at);

-- helpful and not_helpful on one post are mutually exclusive per user.
CREATE UNIQUE INDEX reactions_one_vote ON reactions (post_id, user_id) WHERE kind IN ('helpful', 'not_helpful');
CREATE INDEX reactions_post ON reactions (post_id);

-- Helpful votes on comments (answers to questions, constructive participation, PRD §10.3).
CREATE TABLE comment_reactions (
  comment_id  uuid NOT NULL REFERENCES comments (id),
  user_id     uuid NOT NULL REFERENCES users (id),
  kind        text NOT NULL CHECK (kind IN ('helpful', 'not_helpful')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

-- ---------------------------------------------------------------------------------------------
-- Moderation
-- ---------------------------------------------------------------------------------------------
CREATE TABLE moderation_reports (
  id                 uuid7 PRIMARY KEY,
  reporter_id        uuid NOT NULL REFERENCES users (id),
  target_type        text NOT NULL CHECK (target_type IN ('post', 'comment', 'user')),
  target_id          uuid NOT NULL,
  reason             text NOT NULL CHECK (reason IN ('spam', 'scam', 'harassment', 'impersonation', 'manipulation', 'undisclosed_sponsorship', 'fraudulent_performance', 'other')),
  note               text CHECK (length(note) <= 1000),
  status             text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'actioned', 'dismissed')),
  resolved_by        uuid REFERENCES users (id),
  resolved_at        timestamptz,
  resolution_reason  text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reporter_id, target_type, target_id),
  CHECK ((status = 'open') = (resolved_at IS NULL))
);
CREATE INDEX moderation_reports_open ON moderation_reports (created_at) WHERE status = 'open';

-- ---------------------------------------------------------------------------------------------
-- Benchmark marks (SPY via Finnhub) and frozen thesis evaluations (append-only)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE benchmark_marks (
  id           uuid7 PRIMARY KEY,
  symbol       text NOT NULL CHECK (symbol ~ '^[A-Z.]{1,10}$'),
  price        numeric(20, 6) NOT NULL CHECK (price > 0),
  as_of        timestamptz NOT NULL,
  source       text NOT NULL,
  observed_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (symbol, as_of)
);
CREATE INDEX benchmark_marks_time ON benchmark_marks (symbol, observed_at);

CREATE TABLE thesis_evaluations (
  id                 uuid7 PRIMARY KEY,
  thesis_id          uuid NOT NULL UNIQUE REFERENCES theses (id),
  -- Always the frozen first version (PRD §5.4): later edits never change the evaluation.
  thesis_version     integer NOT NULL CHECK (thesis_version = 1),
  user_id            uuid NOT NULL REFERENCES users (id),
  methodology        text NOT NULL,
  status             text NOT NULL CHECK (status IN ('evaluated', 'unevaluable')),
  direction          text NOT NULL CHECK (direction IN ('bullish', 'bearish', 'neutral')),
  horizon_days       integer NOT NULL,
  window_start       timestamptz NOT NULL,
  window_end         timestamptz NOT NULL,
  symbol             text,
  start_price        numeric(20, 6),
  end_price          numeric(20, 6),
  benchmark_symbol   text NOT NULL,
  benchmark_start    numeric(20, 6),
  benchmark_end      numeric(20, 6),
  -- Returns in parts per million (exact integers).
  instrument_return_ppm  bigint,
  benchmark_return_ppm   bigint,
  relative_return_ppm    bigint,
  correct            boolean,
  reason             text,
  sources            jsonb NOT NULL DEFAULT '{}'::jsonb,
  evaluated_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'evaluated') = (correct IS NOT NULL AND relative_return_ppm IS NOT NULL)),
  CHECK (window_end > window_start)
);
CREATE INDEX thesis_evaluations_user ON thesis_evaluations (user_id, evaluated_at);

-- ---------------------------------------------------------------------------------------------
-- Reputation: snapshot bookkeeping and appeals
-- ---------------------------------------------------------------------------------------------
ALTER TABLE reputation_snapshots
  ADD COLUMN snapshot_hash bytea CHECK (octet_length(snapshot_hash) = 32),
  ADD COLUMN previous_id uuid REFERENCES reputation_snapshots (id),
  -- A building snapshot stores no component totals either (PRD §10.2: no misleading score).
  ADD CONSTRAINT reputation_snapshots_building_no_totals CHECK (
    maturity = 'ranked' OR (investor_score IS NULL AND contribution_score IS NULL)
  ),
  ADD CONSTRAINT reputation_snapshots_ranked_has_score CHECK (
    maturity = 'building' OR (suiem_score IS NOT NULL AND investor_score IS NOT NULL AND contribution_score IS NOT NULL)
  );

CREATE TABLE reputation_appeals (
  id               uuid7 PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users (id),
  snapshot_id      uuid REFERENCES reputation_snapshots (id),
  reason           text NOT NULL CHECK (length(reason) BETWEEN 10 AND 2000),
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'recalculated')),
  resolved_by      uuid REFERENCES users (id),
  resolved_at      timestamptz,
  resolution_note  text CHECK (length(resolution_note) <= 2000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'open') = (resolved_at IS NULL))
);

-- ---------------------------------------------------------------------------------------------
-- In-app notifications
-- ---------------------------------------------------------------------------------------------
CREATE TABLE notifications (
  id          uuid7 PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id),
  kind        text NOT NULL CHECK (kind IN ('new_follower', 'comment', 'reply', 'helpful', 'thesis_evaluated', 'report_outcome', 'appeal_outcome')),
  actor_id    uuid REFERENCES users (id),
  post_id     uuid REFERENCES posts (id),
  comment_id  uuid REFERENCES comments (id),
  thesis_id   uuid REFERENCES theses (id),
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread ON notifications (user_id) WHERE read_at IS NULL;

-- ---------------------------------------------------------------------------------------------
-- Append-only and least privilege
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['thesis_evaluations', 'reputation_snapshots', 'benchmark_marks']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()', t || '_no_truncate', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT, DELETE ON mutes, blocks, comment_reactions TO suiem_app;
GRANT SELECT, INSERT, UPDATE ON moderation_reports, reputation_appeals, notifications TO suiem_app;
GRANT SELECT, INSERT ON thesis_evaluations, benchmark_marks TO suiem_app;
REVOKE UPDATE ON reputation_snapshots FROM suiem_app;
