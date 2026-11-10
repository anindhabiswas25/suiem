-- 0001_foundation: schema for the whole hackathon demo (PHASE_2_PROMPT Sprint 2 §4, ADR-0010).
-- Later sprints add rows, not tables. Single application role in the hackathon build: user
-- scoping is enforced in repositories and API tests (full RLS deferred, ADR-0010 §5).

-- ---------------------------------------------------------------------------------------------
-- Conventions (ARCHITECTURE §6)
-- ---------------------------------------------------------------------------------------------
CREATE DOMAIN uuid7 AS uuid CHECK (substring(VALUE::text FROM 15 FOR 1) = '7');
CREATE DOMAIN token_units AS numeric(78, 0);
CREATE DOMAIN token_decimals AS smallint CHECK (VALUE BETWEEN 0 AND 36);
CREATE DOMAIN fiat_amount AS numeric(20, 6);
CREATE DOMAIN currency_code AS char(3) CHECK (VALUE ~ '^[A-Z]{3}$');
CREATE DOMAIN evm_address AS bytea CHECK (octet_length(VALUE) = 20);
CREATE DOMAIN tx_hash AS bytea CHECK (octet_length(VALUE) = 32);
-- Robinhood Chain mainnet (4663, $WIF only) and testnet (46630). VERIFIED_FACTS C-02, C-03.
CREATE DOMAIN suiem_chain_id AS integer CHECK (VALUE IN (4663, 46630));
CREATE DOMAIN visibility AS text CHECK (VALUE IN ('private', 'followers', 'public'));

-- 'live' exists so code can name it, but every stored book is CHECK-blocked from it.
CREATE TYPE book AS ENUM ('simulated', 'testnet', 'live');
CREATE DOMAIN ledger_book AS book CHECK (VALUE <> 'live');

CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %: % is not allowed', TG_TABLE_NAME, TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Identity: passkey + SIWE (PO decision, ADR-0010 §4). No email.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE users (
  id            uuid7 PRIMARY KEY,
  handle        text NOT NULL UNIQUE CHECK (handle ~ '^[a-z0-9_]{3,24}$'),
  display_name  text CHECK (length(display_name) BETWEEN 1 AND 60),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'restricted', 'deletion_requested', 'deleted')),
  is_demo       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- External wallets linked via SIWE (EIP-4361). Keys never reach the backend.
CREATE TABLE wallet_accounts (
  id                 uuid7 PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users (id),
  address            evm_address NOT NULL,
  -- Chain the SIWE message was signed for (4663 or 46630). An EOA address is the same on both.
  chain_id           suiem_chain_id NOT NULL,
  siwe_message_hash  bytea NOT NULL CHECK (octet_length(siwe_message_hash) = 32),
  linked_at          timestamptz NOT NULL DEFAULT now(),
  unlinked_at        timestamptz
);
CREATE UNIQUE INDEX wallet_accounts_active_address ON wallet_accounts (address) WHERE unlinked_at IS NULL;
CREATE INDEX wallet_accounts_user ON wallet_accounts (user_id);

CREATE TABLE auth_methods (
  id                 uuid7 PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users (id),
  kind               text NOT NULL CHECK (kind IN ('passkey', 'siwe')),
  credential_id      bytea UNIQUE,
  public_key         bytea,
  sign_count         bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  transports         text[] NOT NULL DEFAULT '{}',
  device_type        text CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up          boolean,
  wallet_account_id  uuid REFERENCES wallet_accounts (id),
  label              text CHECK (length(label) <= 60),
  created_at         timestamptz NOT NULL DEFAULT now(),
  last_used_at       timestamptz,
  revoked_at         timestamptz,
  CHECK ((kind = 'passkey') = (credential_id IS NOT NULL AND public_key IS NOT NULL)),
  CHECK ((kind = 'siwe') = (wallet_account_id IS NOT NULL))
);
CREATE INDEX auth_methods_user ON auth_methods (user_id);

CREATE TABLE sessions (
  id            uuid7 PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users (id),
  token_hash    bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  amr           text[] NOT NULL CHECK (amr <@ ARRAY['passkey', 'siwe']::text[] AND cardinality(amr) > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL,
  revoked_at    timestamptz,
  rotated_from  uuid REFERENCES sessions (id),
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user ON sessions (user_id);

CREATE TABLE user_preferences (
  user_id                  uuid PRIMARY KEY REFERENCES users (id),
  interests                text[] NOT NULL DEFAULT '{}' CHECK (cardinality(interests) <= 20),
  interests_skipped        boolean NOT NULL DEFAULT false,
  experience_level         text CHECK (experience_level IN ('beginner', 'intermediate', 'experienced')),
  research_depth           text CHECK (research_depth IN ('plain_language', 'balanced', 'detailed')),
  -- Self-declared, used server-side for Stock Token gating (VERIFIED_FACTS J-01, OQ-H-02).
  jurisdiction             char(2) CHECK (jurisdiction ~ '^[A-Z]{2}$'),
  onboarding_completed_at  timestamptz,
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER user_preferences_touch BEFORE UPDATE ON user_preferences FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Consent (ADR-0003)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE policy_versions (
  id              uuid7 PRIMARY KEY,
  purpose         text NOT NULL CHECK (purpose IN ('terms', 'privacy', 'product_analytics', 'marketing_email', 'extension_detection', 'digest_sync')),
  version         text NOT NULL CHECK (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$'),
  title           text NOT NULL,
  summary_url     text NOT NULL,
  content_sha256  bytea NOT NULL CHECK (octet_length(content_sha256) = 32),
  published_at    timestamptz NOT NULL,
  UNIQUE (purpose, version)
);

CREATE TABLE consent_records (
  id              uuid7 PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users (id),
  purpose         text NOT NULL,
  policy_version  text NOT NULL,
  action          text NOT NULL CHECK (action IN ('granted', 'withdrawn')),
  source          text NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'extension', 'system')),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (purpose, policy_version) REFERENCES policy_versions (purpose, version)
);
CREATE INDEX consent_records_user ON consent_records (user_id, purpose, recorded_at);

-- ---------------------------------------------------------------------------------------------
-- Entity and instrument registry (PRD §8.1). Never resolve a mention straight to an address.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE entities (
  id            uuid7 PRIMARY KEY,
  canonical_id  text NOT NULL UNIQUE CHECK (canonical_id ~ '^ent:[a-z0-9-]+$'),
  name          text NOT NULL,
  legal_name    text,
  kind          text NOT NULL CHECK (kind IN ('company', 'product', 'fund', 'index', 'crypto')),
  sector        text,
  country       char(2),
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE entity_aliases (
  id          uuid7 PRIMARY KEY,
  entity_id   uuid NOT NULL REFERENCES entities (id),
  alias       text NOT NULL CHECK (length(alias) BETWEEN 1 AND 80),
  alias_type  text NOT NULL CHECK (alias_type IN ('name', 'legal_name', 'ticker', 'cashtag', 'exchange_symbol', 'product')),
  -- Ambiguous aliases (ordinary words, ticker collisions) must never produce an assertive match (PRD §6.3).
  ambiguous   boolean NOT NULL DEFAULT false,
  UNIQUE (entity_id, alias, alias_type)
);
CREATE INDEX entity_aliases_lookup ON entity_aliases (lower(alias));

CREATE TABLE instruments (
  id                uuid7 PRIMARY KEY,
  entity_id         uuid REFERENCES entities (id),
  symbol            text NOT NULL CHECK (symbol ~ '^(SIM|TEST|DEMO):[A-Z0-9.]{1,12}$'),
  display_name      text NOT NULL,
  network           text NOT NULL CHECK (network IN ('mainnet', 'testnet', 'offchain')),
  chain_id          suiem_chain_id,
  -- No real-security legal types exist in this schema (ADR-0001 §6, ADR-0004).
  legal_type        text NOT NULL CHECK (legal_type IN ('simulated', 'testnet_test_token', 'demo_token', 'unsupported')),
  contract_address  evm_address,
  decimals          token_decimals NOT NULL,
  quote_currency    currency_code NOT NULL DEFAULT 'USD',
  status            text NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'active', 'halted', 'unsupported')),
  source_url        text,
  last_verified_at  timestamptz,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (symbol),
  CHECK ((network = 'offchain') = (chain_id IS NULL)),
  CHECK (network <> 'mainnet'),
  CHECK (legal_type <> 'simulated' OR network = 'offchain'),
  CHECK (legal_type NOT IN ('testnet_test_token', 'demo_token') OR (network = 'testnet' AND chain_id = 46630)),
  -- An onchain instrument can only be active with a contract address and a verification record.
  CHECK (status <> 'active' OR network = 'offchain' OR (contract_address IS NOT NULL AND last_verified_at IS NOT NULL AND source_url IS NOT NULL))
);

-- ---------------------------------------------------------------------------------------------
-- Research, watchlists, theses
-- ---------------------------------------------------------------------------------------------
CREATE TABLE research_briefs (
  id               uuid7 PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users (id),
  entity_id        uuid REFERENCES entities (id),
  schema_version   text NOT NULL,
  brief            jsonb NOT NULL,
  model            text NOT NULL,
  prompt_version   text NOT NULL,
  data_freshness   text NOT NULL CHECK (data_freshness IN ('fresh', 'stale', 'partial', 'unknown')),
  visibility       visibility NOT NULL DEFAULT 'private',
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX research_briefs_user ON research_briefs (user_id, created_at DESC);

CREATE TABLE brief_sources (
  id            uuid7 PRIMARY KEY,
  brief_id      uuid NOT NULL REFERENCES research_briefs (id),
  url           text NOT NULL CHECK (url ~ '^https?://'),
  title         text NOT NULL,
  publisher     text,
  published_at  timestamptz,
  retrieved_at  timestamptz NOT NULL,
  supports      text[] NOT NULL DEFAULT '{}'
);

CREATE TABLE watchlists (
  id          uuid7 PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, name)
);

CREATE TABLE watchlist_items (
  id             uuid7 PRIMARY KEY,
  watchlist_id   uuid NOT NULL REFERENCES watchlists (id),
  entity_id      uuid NOT NULL REFERENCES entities (id),
  instrument_id  uuid REFERENCES instruments (id),
  note           text CHECK (length(note) <= 500),
  added_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (watchlist_id, entity_id)
);

CREATE TABLE theses (
  id               uuid7 PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users (id),
  entity_id        uuid NOT NULL REFERENCES entities (id),
  instrument_id    uuid REFERENCES instruments (id),
  current_version  integer NOT NULL DEFAULT 1 CHECK (current_version >= 1),
  visibility       visibility NOT NULL DEFAULT 'private',
  status           text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  published_at     timestamptz
);
CREATE TRIGGER theses_touch BEFORE UPDATE ON theses FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Frozen versions: scoring uses the original, never a rewritten thesis (PRD §5.4).
CREATE TABLE thesis_versions (
  id                uuid7 PRIMARY KEY,
  thesis_id         uuid NOT NULL REFERENCES theses (id),
  version           integer NOT NULL CHECK (version >= 1),
  direction         text NOT NULL CHECK (direction IN ('bullish', 'bearish', 'neutral')),
  horizon_days      integer NOT NULL CHECK (horizon_days BETWEEN 1 AND 3650),
  title             text NOT NULL CHECK (length(title) BETWEEN 3 AND 140),
  rationale         text NOT NULL,
  evidence          jsonb NOT NULL DEFAULT '[]'::jsonb,
  counterarguments  text NOT NULL,
  risks             text NOT NULL,
  invalidation      text NOT NULL,
  price_context     jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thesis_id, version)
);

-- ---------------------------------------------------------------------------------------------
-- Invest: orders and ledger (ADR-0004). Books: simulated | testnet. 'live' is blocked.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE orders (
  id                    uuid7 PRIMARY KEY,
  user_id               uuid NOT NULL REFERENCES users (id),
  instrument_id         uuid NOT NULL REFERENCES instruments (id),
  book                  ledger_book NOT NULL,
  side                  text NOT NULL CHECK (side IN ('buy', 'sell')),
  status                text NOT NULL CHECK (status IN ('previewed', 'submitted', 'pending', 'partially_filled', 'filled', 'failed', 'expired', 'cancelled')),
  quote_amount          token_units NOT NULL CHECK (quote_amount > 0),
  quote_decimals        token_decimals NOT NULL,
  quote_asset           text NOT NULL,
  est_quantity          token_units NOT NULL CHECK (est_quantity >= 0),
  quantity_decimals     token_decimals NOT NULL,
  fee_amount            token_units NOT NULL DEFAULT 0 CHECK (fee_amount >= 0),
  max_slippage_bps      integer NOT NULL CHECK (max_slippage_bps BETWEEN 0 AND 1000),
  quote_at              timestamptz NOT NULL,
  quote_expires_at      timestamptz NOT NULL,
  chain_id              suiem_chain_id,
  tx_hash               tx_hash,
  preview_hash          bytea NOT NULL CHECK (octet_length(preview_hash) = 32),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (quote_expires_at > quote_at),
  CHECK (book::text <> 'testnet' OR chain_id = 46630),
  CHECK (book::text <> 'simulated' OR (chain_id IS NULL AND tx_hash IS NULL))
);
CREATE UNIQUE INDEX orders_tx_unique ON orders (chain_id, tx_hash) WHERE tx_hash IS NOT NULL;
CREATE TRIGGER orders_touch BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE order_events (
  id          uuid7 PRIMARY KEY,
  order_id    uuid NOT NULL REFERENCES orders (id),
  status      text NOT NULL,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fills (
  id                 uuid7 PRIMARY KEY,
  order_id           uuid NOT NULL REFERENCES orders (id),
  quantity           token_units NOT NULL CHECK (quantity > 0),
  quantity_decimals  token_decimals NOT NULL,
  price              token_units NOT NULL CHECK (price > 0),
  price_decimals     token_decimals NOT NULL,
  fee_amount         token_units NOT NULL DEFAULT 0,
  chain_id           suiem_chain_id,
  tx_hash            tx_hash,
  log_index          integer,
  filled_at          timestamptz NOT NULL,
  CHECK ((chain_id IS NULL) = (tx_hash IS NULL))
);
CREATE UNIQUE INDEX fills_onchain_unique ON fills (chain_id, tx_hash, log_index) WHERE tx_hash IS NOT NULL;

CREATE TABLE positions (
  id                 uuid7 PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users (id),
  instrument_id      uuid NOT NULL REFERENCES instruments (id),
  book               ledger_book NOT NULL,
  quantity           token_units NOT NULL CHECK (quantity >= 0),
  quantity_decimals  token_decimals NOT NULL,
  cost_basis         token_units NOT NULL CHECK (cost_basis >= 0),
  cost_decimals      token_decimals NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, instrument_id, book)
);

CREATE TABLE ledger_entries (
  id             uuid7 PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users (id),
  book           ledger_book NOT NULL,
  instrument_id  uuid REFERENCES instruments (id),
  asset          text NOT NULL,
  amount         token_units NOT NULL,
  decimals       token_decimals NOT NULL,
  entry_type     text NOT NULL CHECK (entry_type IN ('deposit', 'buy', 'sell', 'fee', 'adjustment')),
  order_id       uuid REFERENCES orders (id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_user ON ledger_entries (user_id, book, created_at);

-- ---------------------------------------------------------------------------------------------
-- Social (PRD §9). Financial fields private by default.
-- ---------------------------------------------------------------------------------------------
CREATE TABLE profiles (
  user_id                        uuid PRIMARY KEY REFERENCES users (id),
  bio                            text CHECK (length(bio) <= 500),
  portfolio_visibility           visibility NOT NULL DEFAULT 'private',
  positions_visibility           visibility NOT NULL DEFAULT 'private',
  transactions_visibility        visibility NOT NULL DEFAULT 'private',
  research_activity_visibility   visibility NOT NULL DEFAULT 'private',
  followers_visibility           visibility NOT NULL DEFAULT 'public',
  wallet_visibility              visibility NOT NULL DEFAULT 'private',
  appear_in_leaderboards         boolean NOT NULL DEFAULT false,
  updated_at                     timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER profiles_touch BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE follows (
  follower_id  uuid NOT NULL REFERENCES users (id),
  followee_id  uuid NOT NULL REFERENCES users (id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);

CREATE TABLE posts (
  id            uuid7 PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users (id),
  kind          text NOT NULL CHECK (kind IN ('research_brief', 'thesis', 'discussion', 'portfolio_snapshot', 'learning_note', 'question', 'election_nomination')),
  body          text NOT NULL CHECK (length(body) BETWEEN 1 AND 10000),
  entity_id     uuid REFERENCES entities (id),
  thesis_id     uuid REFERENCES theses (id),
  brief_id      uuid REFERENCES research_briefs (id),
  visibility    visibility NOT NULL DEFAULT 'public',
  ai_assisted   boolean NOT NULL DEFAULT false,
  sponsored     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);
CREATE INDEX posts_feed ON posts (created_at DESC) WHERE deleted_at IS NULL;

CREATE TABLE comments (
  id          uuid7 PRIMARY KEY,
  post_id     uuid NOT NULL REFERENCES posts (id),
  user_id     uuid NOT NULL REFERENCES users (id),
  parent_id   uuid REFERENCES comments (id),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at  timestamptz NOT NULL DEFAULT now(),
  deleted_at  timestamptz
);

CREATE TABLE reactions (
  post_id     uuid NOT NULL REFERENCES posts (id),
  user_id     uuid NOT NULL REFERENCES users (id),
  kind        text NOT NULL CHECK (kind IN ('like', 'helpful', 'not_helpful')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id, kind)
);

CREATE TABLE bookmarks (
  user_id     uuid NOT NULL REFERENCES users (id),
  post_id     uuid NOT NULL REFERENCES posts (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, post_id)
);

-- ---------------------------------------------------------------------------------------------
-- Reputation (PRD §10). $WIF never feeds this (no FK to elections by design).
-- ---------------------------------------------------------------------------------------------
CREATE TABLE reputation_evidence (
  id                    uuid7 PRIMARY KEY,
  user_id               uuid NOT NULL REFERENCES users (id),
  component             text NOT NULL CHECK (component IN ('risk_adjusted_performance', 'thesis_outcome', 'consistency', 'risk_management', 'research_quality', 'helpful_feedback', 'educational', 'participation')),
  source_type           text NOT NULL CHECK (source_type IN ('fill', 'thesis_evaluation', 'brief', 'post', 'reaction', 'comment')),
  source_id             uuid NOT NULL,
  book                  ledger_book,
  value                 numeric(20, 6) NOT NULL,
  methodology_version   text NOT NULL,
  observed_at           timestamptz NOT NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (component, source_type, source_id, methodology_version)
);

CREATE TABLE reputation_snapshots (
  id                    uuid7 PRIMARY KEY,
  user_id               uuid NOT NULL REFERENCES users (id),
  methodology_version   text NOT NULL,
  maturity              text NOT NULL CHECK (maturity IN ('building', 'ranked')),
  suiem_score           numeric(5, 2) CHECK (suiem_score BETWEEN 0 AND 100),
  investor_score        numeric(5, 2) CHECK (investor_score BETWEEN 0 AND 100),
  contribution_score    numeric(5, 2) CHECK (contribution_score BETWEEN 0 AND 100),
  components            jsonb NOT NULL,
  computed_at           timestamptz NOT NULL DEFAULT now(),
  -- "Building track record" profiles show no score (PRD §10.2).
  CHECK (maturity = 'ranked' OR suiem_score IS NULL)
);
CREATE INDEX reputation_snapshots_user ON reputation_snapshots (user_id, computed_at DESC);

-- ---------------------------------------------------------------------------------------------
-- $WIF economy (mainnet 4663 only, ADR-0010)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE elections (
  id                   uuid7 PRIMARY KEY,
  slug                 text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{3,64}$'),
  title                text NOT NULL,
  category             text NOT NULL CHECK (category IN ('research_contributor', 'investor', 'educational', 'community_spotlight')),
  chain_id             suiem_chain_id NOT NULL CHECK (chain_id = 4663),
  contract_address     evm_address,
  onchain_election_id  token_units,
  starts_at            timestamptz NOT NULL,
  ends_at              timestamptz NOT NULL,
  status               text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'open', 'closed', 'finalized', 'cancelled')),
  rules                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by           uuid REFERENCES users (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  finalized_at         timestamptz,
  CHECK (ends_at > starts_at),
  CHECK (status IN ('draft', 'cancelled') OR (contract_address IS NOT NULL AND onchain_election_id IS NOT NULL))
);

CREATE TABLE election_candidates (
  id                    uuid7 PRIMARY KEY,
  election_id           uuid NOT NULL REFERENCES elections (id),
  user_id               uuid NOT NULL REFERENCES users (id),
  onchain_candidate_id  token_units,
  nomination_post_id    uuid REFERENCES posts (id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (election_id, user_id),
  UNIQUE (election_id, onchain_candidate_id)
);

-- Raw indexed events, idempotent on (chain_id, tx_hash, log_index). Reorged logs are marked removed.
CREATE TABLE chain_events (
  id                uuid7 PRIMARY KEY,
  chain_id          suiem_chain_id NOT NULL,
  contract_address  evm_address NOT NULL,
  tx_hash           tx_hash NOT NULL,
  log_index         integer NOT NULL CHECK (log_index >= 0),
  block_number      bigint NOT NULL,
  block_hash        bytea NOT NULL CHECK (octet_length(block_hash) = 32),
  event_name        text NOT NULL,
  args              jsonb NOT NULL,
  finality          text NOT NULL CHECK (finality IN ('soft', 'safe', 'final')),
  removed           boolean NOT NULL DEFAULT false,
  observed_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chain_id, tx_hash, log_index)
);
CREATE INDEX chain_events_block ON chain_events (chain_id, block_number);

CREATE TABLE election_tallies (
  election_id    uuid NOT NULL REFERENCES elections (id),
  candidate_id   uuid NOT NULL REFERENCES election_candidates (id),
  votes          token_units NOT NULL DEFAULT 0 CHECK (votes >= 0),
  decimals       token_decimals NOT NULL DEFAULT 18,
  as_of_block    bigint NOT NULL,
  finality       text NOT NULL CHECK (finality IN ('soft', 'safe', 'final')),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (election_id, candidate_id)
);

-- ---------------------------------------------------------------------------------------------
-- Operations
-- ---------------------------------------------------------------------------------------------
CREATE TABLE audit_logs (
  id             uuid7 PRIMARY KEY,
  occurred_at    timestamptz NOT NULL DEFAULT now(),
  actor_type     text NOT NULL CHECK (actor_type IN ('user', 'admin', 'system', 'anonymous')),
  actor_user_id  uuid REFERENCES users (id),
  action         text NOT NULL CHECK (action ~ '^[a-z0-9_.]+$'),
  target_type    text,
  target_id      text,
  outcome        text NOT NULL CHECK (outcome IN ('success', 'denied', 'error')),
  request_id     text,
  details        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_logs_time ON audit_logs (occurred_at DESC);

CREATE TABLE idempotency_keys (
  scope            text NOT NULL,
  route            text NOT NULL,
  key              text NOT NULL CHECK (key ~ '^[A-Za-z0-9_-]{16,128}$'),
  request_hash     bytea NOT NULL CHECK (octet_length(request_hash) = 32),
  response_status  integer,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  PRIMARY KEY (scope, route, key)
);

-- trading.live is hard-off at the database level (PRD §17, ADR-0004 §2).
CREATE TABLE feature_flags (
  key         text PRIMARY KEY CHECK (key IN ('trading.live', 'trading.testnet', 'elections', 'campaigns')),
  enabled     boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trading_live_hard_off CHECK (NOT (key = 'trading.live' AND enabled))
);
CREATE FUNCTION protect_hard_off_flags() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.key = 'trading.live' THEN
    RAISE EXCEPTION 'feature flag trading.live cannot be deleted or renamed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER feature_flags_protect_delete BEFORE DELETE ON feature_flags FOR EACH ROW EXECUTE FUNCTION protect_hard_off_flags();
CREATE TRIGGER feature_flags_protect_rename BEFORE UPDATE OF key ON feature_flags FOR EACH ROW EXECUTE FUNCTION protect_hard_off_flags();

-- ---------------------------------------------------------------------------------------------
-- Append-only history (PRD §14)
-- ---------------------------------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['consent_records', 'thesis_versions', 'order_events', 'ledger_entries', 'reputation_evidence', 'audit_logs', 'policy_versions']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_mutation()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation()', t || '_no_truncate', t);
  END LOOP;
END $$;
