-- 0004_research: AI research, registry CIKs, feedback, follow-up questions, thesis reviews (Sprint 4).

-- SEC Central Index Key (10 digits, zero-padded). NULL for entities without SEC filings (crypto, indexes).
ALTER TABLE entities ADD COLUMN cik char(10) CHECK (cik ~ '^[0-9]{10}$');

-- Cache of PUBLIC provider responses only (EDGAR, Finnhub). Never user data.
CREATE TABLE research_source_cache (
  provider      text NOT NULL CHECK (provider IN ('edgar', 'finnhub')),
  key           text NOT NULL CHECK (length(key) <= 300),
  payload       jsonb NOT NULL,
  retrieved_at  timestamptz NOT NULL,
  expires_at    timestamptz NOT NULL,
  PRIMARY KEY (provider, key)
);

-- Briefs keep the exact source pack they were generated from (follow-up questions use only that pack).
ALTER TABLE research_briefs
  ADD COLUMN source_pack jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- false when the request included the user's own excerpt: such briefs are never cached or reused.
  ADD COLUMN public_only boolean NOT NULL DEFAULT true,
  ADD COLUMN cached_from uuid REFERENCES research_briefs (id),
  ADD COLUMN generated_at timestamptz NOT NULL DEFAULT now(),
  -- Which provider actually produced the brief (groq | gemini); `model` holds the model ID.
  ADD COLUMN provider text NOT NULL DEFAULT 'unknown';
CREATE INDEX research_briefs_cache_lookup ON research_briefs (entity_id, prompt_version, generated_at DESC) WHERE public_only AND cached_from IS NULL;

ALTER TABLE research_requests
  ADD COLUMN failure_reason text CHECK (length(failure_reason) <= 300),
  ADD COLUMN source text NOT NULL DEFAULT 'extension' CHECK (source IN ('extension', 'web'));
-- Web requests have no page URL; extension requests always do.
ALTER TABLE research_requests ALTER COLUMN source_url DROP NOT NULL;
ALTER TABLE research_requests ADD CONSTRAINT research_requests_source_url_required CHECK (source <> 'extension' OR source_url IS NOT NULL);

CREATE TABLE brief_feedback (
  id          uuid7 PRIMARY KEY,
  brief_id    uuid NOT NULL REFERENCES research_briefs (id),
  user_id     uuid NOT NULL REFERENCES users (id),
  kind        text NOT NULL CHECK (kind IN ('helpful', 'incorrect', 'outdated')),
  note        text CHECK (length(note) <= 1000),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE research_questions (
  id          uuid7 PRIMARY KEY,
  brief_id    uuid NOT NULL REFERENCES research_briefs (id),
  user_id     uuid NOT NULL REFERENCES users (id),
  question    text NOT NULL CHECK (length(question) BETWEEN 3 AND 500),
  answer      jsonb NOT NULL,
  model       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX research_questions_brief ON research_questions (brief_id, created_at);

-- Outcome reviews never edit the frozen thesis versions (PRD §5.4).
CREATE TABLE thesis_reviews (
  id          uuid7 PRIMARY KEY,
  thesis_id   uuid NOT NULL REFERENCES theses (id),
  user_id     uuid NOT NULL REFERENCES users (id),
  outcome     text NOT NULL CHECK (outcome IN ('played_out', 'did_not_play_out', 'mixed', 'too_early')),
  note        text NOT NULL CHECK (length(note) BETWEEN 1 AND 4000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER thesis_reviews_append_only BEFORE UPDATE OR DELETE ON thesis_reviews FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER thesis_reviews_no_truncate BEFORE TRUNCATE ON thesis_reviews FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Watchlist items can link to a thesis (notes use the existing `note` column).
ALTER TABLE watchlist_items ADD COLUMN thesis_id uuid REFERENCES theses (id);

-- Least privilege for the API role.
GRANT SELECT, INSERT, UPDATE ON research_source_cache, brief_feedback, research_questions, thesis_reviews TO suiem_app;
REVOKE UPDATE ON thesis_reviews FROM suiem_app;
GRANT DELETE ON research_source_cache TO suiem_app;
