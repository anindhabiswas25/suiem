-- 0001_foundation: Phase 2 platform tables (IMPLEMENTATION_PLAN E2.4, ARCHITECTURE §6).
-- Run as the schema owner. Roles suiem_app (RLS enforced) and suiem_system (BYPASSRLS) must exist.

-- ---------------------------------------------------------------------------------------------
-- Conventions: domains
-- ---------------------------------------------------------------------------------------------
-- UUIDv7 identifiers (time-ordered). Generated in the application, validated here.
CREATE DOMAIN uuid7 AS uuid CHECK (substring(VALUE::text FROM 15 FOR 1) = '7');

-- Token amounts in integer base units, paired with a `decimals` column (no floats, ever).
CREATE DOMAIN token_units AS numeric(78, 0);
CREATE DOMAIN token_decimals AS smallint CHECK (VALUE BETWEEN 0 AND 36);

-- Fiat amounts with a separate ISO-4217 currency column.
CREATE DOMAIN fiat_amount AS numeric(20, 6);
CREATE DOMAIN currency_code AS char(3) CHECK (VALUE ~ '^[A-Z]{3}$');

-- EVM addresses as 20 raw bytes, always paired with chain_id.
CREATE DOMAIN evm_address AS bytea CHECK (octet_length(VALUE) = 20);

-- Accounting books. 'live' exists as a value so code can name it, but is CHECK-blocked
-- in every column that stores a book (ADR-0001 §1, ADR-0004 §2).
CREATE TYPE book AS ENUM ('simulated', 'testnet', 'live');
CREATE DOMAIN ledger_book AS book CHECK (VALUE <> 'live');

-- Suiem only targets Robinhood Chain Testnet (VERIFIED_FACTS C-02).
CREATE DOMAIN suiem_chain_id AS integer CHECK (VALUE = 46630);

-- ---------------------------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION app_current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

CREATE FUNCTION forbid_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'append-only table %: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE FUNCTION touch_updated_at() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------------------------
CREATE TABLE users (
  id          uuid7 PRIMARY KEY,
  email       text NOT NULL UNIQUE CHECK (email = lower(email) AND length(email) <= 254 AND position('@' IN email) > 1),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'restricted', 'deletion_requested', 'deleted')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER users_touch BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Login methods (PO decision OQ-P-05). New kinds need a migration (AuthMethod extension point).
CREATE TABLE user_auth_methods (
  id             uuid7 PRIMARY KEY,
  user_id        uuid NOT NULL REFERENCES users (id),
  kind           text NOT NULL CHECK (kind IN ('email_otp', 'passkey')),
  credential_id  bytea UNIQUE,
  public_key     bytea,
  sign_count     bigint NOT NULL DEFAULT 0 CHECK (sign_count >= 0),
  transports     text[] NOT NULL DEFAULT '{}',
  device_type    text CHECK (device_type IN ('singleDevice', 'multiDevice')),
  backed_up      boolean,
  label          text CHECK (length(label) <= 60),
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz,
  revoked_at     timestamptz,
  CHECK ((kind = 'passkey') = (credential_id IS NOT NULL AND public_key IS NOT NULL))
);
CREATE UNIQUE INDEX user_auth_methods_one_email ON user_auth_methods (user_id) WHERE kind = 'email_otp';
CREATE INDEX user_auth_methods_user ON user_auth_methods (user_id);

CREATE TABLE user_sessions (
  id               uuid7 PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users (id),
  token_hash       bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  amr              text[] NOT NULL CHECK (amr <@ ARRAY['email_otp', 'passkey']::text[] AND cardinality(amr) > 0),
  passkey_verified_at timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  revoked_at       timestamptz,
  rotated_from     uuid REFERENCES user_sessions (id),
  CHECK (expires_at > created_at)
);
CREATE INDEX user_sessions_user ON user_sessions (user_id);

CREATE TABLE devices (
  id            uuid7 PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users (id),
  kind          text NOT NULL CHECK (kind IN ('browser', 'extension')),
  label         text CHECK (length(label) <= 60),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);
CREATE INDEX devices_user ON devices (user_id);

-- Wallet LINKING only (SIWE). Never a login method. Keys never reach the backend (PRD §16.2).
CREATE TABLE wallet_accounts (
  id                 uuid7 PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES users (id),
  chain_id           suiem_chain_id NOT NULL,
  address            evm_address NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('external_eoa', 'smart_account')),
  siwe_message_hash  bytea NOT NULL CHECK (octet_length(siwe_message_hash) = 32),
  linked_at          timestamptz NOT NULL DEFAULT now(),
  unlinked_at        timestamptz
);
-- One active link per wallet across all users (reduces account farming).
CREATE UNIQUE INDEX wallet_accounts_active_unique ON wallet_accounts (chain_id, address) WHERE unlinked_at IS NULL;
CREATE INDEX wallet_accounts_user ON wallet_accounts (user_id);

CREATE TABLE user_preferences (
  user_id            uuid PRIMARY KEY REFERENCES users (id),
  interests          text[] NOT NULL DEFAULT '{}',
  interests_skipped  boolean NOT NULL DEFAULT false,
  experience_level   text CHECK (experience_level IN ('beginner', 'intermediate', 'experienced')),
  research_depth     text CHECK (research_depth IN ('plain_language', 'balanced', 'detailed')),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK (cardinality(interests) <= 20)
);
CREATE TRIGGER user_preferences_touch BEFORE UPDATE ON user_preferences FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Minimal profile. Financial visibility fields arrive in Phase 5 and default to private (ADR-0003 §4).
CREATE TABLE profiles (
  user_id                  uuid PRIMARY KEY REFERENCES users (id),
  display_name             text CHECK (length(display_name) BETWEEN 1 AND 60),
  jurisdiction             char(2) CHECK (jurisdiction ~ '^[A-Z]{2}$'),
  onboarding_completed_at  timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER profiles_touch BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------------------------------------------------------------------------------------------
-- Consent and privacy (ADR-0003)
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
CREATE TRIGGER policy_versions_append_only BEFORE UPDATE OR DELETE ON policy_versions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

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

CREATE TABLE data_requests (
  id            uuid7 PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users (id),
  type          text NOT NULL CHECK (type IN ('export', 'delete')),
  status        text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'processing', 'completed', 'rejected')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);
-- At most one open request of each type per user.
CREATE UNIQUE INDEX data_requests_one_open ON data_requests (user_id, type) WHERE status IN ('received', 'processing');
CREATE TRIGGER data_requests_touch BEFORE UPDATE ON data_requests FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

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
  reason_code    text,
  request_id     text,
  -- Allowlisted, redacted fields only (see apps/api/src/observability/redact.ts).
  details        jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_logs_time ON audit_logs (occurred_at DESC);
CREATE INDEX audit_logs_actor ON audit_logs (actor_user_id, occurred_at DESC);
CREATE INDEX audit_logs_action ON audit_logs (action, occurred_at DESC);

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

CREATE TABLE outbox_events (
  id            uuid7 PRIMARY KEY,
  topic         text NOT NULL CHECK (topic ~ '^[a-z0-9_.]+$'),
  payload       jsonb NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  published_at  timestamptz,
  attempts      integer NOT NULL DEFAULT 0
);
CREATE INDEX outbox_events_unpublished ON outbox_events (created_at) WHERE published_at IS NULL;

-- Feature flags. trading.live is hard-off at the database level (PRD §17, ADR-0004 §2).
CREATE TABLE feature_flags (
  key         text PRIMARY KEY CHECK (key IN ('trading.live', 'trading.simulated', 'elections', 'campaigns')),
  enabled     boolean NOT NULL DEFAULT false,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES users (id),
  CONSTRAINT trading_live_hard_off CHECK (NOT (key = 'trading.live' AND enabled))
);
CREATE FUNCTION protect_hard_off_flags() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.key = 'trading.live' THEN
    RAISE EXCEPTION 'feature flag trading.live cannot be deleted or renamed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER feature_flags_protect_delete BEFORE DELETE ON feature_flags FOR EACH ROW EXECUTE FUNCTION protect_hard_off_flags();
CREATE TRIGGER feature_flags_protect_rename BEFORE UPDATE OF key ON feature_flags FOR EACH ROW EXECUTE FUNCTION protect_hard_off_flags();

-- Jurisdiction policies are versioned documents. No version may ever allow live trading.
CREATE TABLE jurisdiction_policies (
  version       text PRIMARY KEY CHECK (version ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}\.[0-9]+$'),
  rules         jsonb NOT NULL,
  published_at  timestamptz NOT NULL DEFAULT now(),
  created_by    uuid REFERENCES users (id),
  CONSTRAINT jurisdiction_no_live_trading CHECK (NOT jsonb_path_exists(rules, '$.**.live_trading ? (@ == true)'))
);
CREATE TRIGGER jurisdiction_policies_append_only BEFORE UPDATE OR DELETE ON jurisdiction_policies FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE policy_decisions (
  id               uuid7 PRIMARY KEY,
  decided_at       timestamptz NOT NULL DEFAULT now(),
  policy_version   text NOT NULL REFERENCES jurisdiction_policies (version),
  capability       text NOT NULL,
  subject_user_id  uuid REFERENCES users (id),
  jurisdiction     char(2),
  allowed          boolean NOT NULL,
  reason           text NOT NULL,
  request_id       text
);
CREATE INDEX policy_decisions_time ON policy_decisions (decided_at DESC);

-- ---------------------------------------------------------------------------------------------
-- Admin (ADR-0010)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE admin_roles (
  id          uuid7 PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id),
  role        text NOT NULL CHECK (role IN ('support', 'moderator', 'ops', 'security', 'superadmin')),
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  uuid REFERENCES users (id),
  revoked_at  timestamptz,
  revoked_by  uuid REFERENCES users (id)
);
CREATE UNIQUE INDEX admin_roles_active ON admin_roles (user_id, role) WHERE revoked_at IS NULL;

CREATE TABLE dual_control_requests (
  id                    uuid7 PRIMARY KEY,
  action                text NOT NULL CHECK (action IN ('feature_flag.set', 'admin_role.grant', 'admin_role.revoke')),
  payload               jsonb NOT NULL,
  requested_by          uuid NOT NULL REFERENCES users (id),
  requested_at          timestamptz NOT NULL DEFAULT now(),
  reason_code           text NOT NULL,
  reason_note           text NOT NULL,
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'executed', 'failed')),
  decided_by            uuid REFERENCES users (id),
  decided_at            timestamptz,
  decision_reason_code  text,
  decision_note         text,
  expires_at            timestamptz NOT NULL,
  CONSTRAINT dual_control_distinct_approver CHECK (decided_by IS NULL OR decided_by <> requested_by),
  CONSTRAINT dual_control_decided_consistency CHECK ((status IN ('pending', 'expired')) = (decided_by IS NULL))
);

CREATE TABLE admin_actions (
  id                        uuid7 PRIMARY KEY,
  occurred_at               timestamptz NOT NULL DEFAULT now(),
  admin_user_id             uuid NOT NULL REFERENCES users (id),
  action                    text NOT NULL,
  target_type               text,
  target_id                 text,
  reason_code               text NOT NULL,
  reason_note               text NOT NULL,
  dual_control_request_id   uuid REFERENCES dual_control_requests (id),
  outcome                   text NOT NULL CHECK (outcome IN ('success', 'denied', 'error')),
  details                   jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- ---------------------------------------------------------------------------------------------
-- Append-only enforcement (PRD §14: immutable history for evidence)
-- ---------------------------------------------------------------------------------------------
CREATE TRIGGER consent_records_append_only BEFORE UPDATE OR DELETE ON consent_records FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER policy_decisions_append_only BEFORE UPDATE OR DELETE ON policy_decisions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER admin_actions_append_only BEFORE UPDATE OR DELETE ON admin_actions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER consent_records_no_truncate BEFORE TRUNCATE ON consent_records FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER audit_logs_no_truncate BEFORE TRUNCATE ON audit_logs FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER policy_decisions_no_truncate BEFORE TRUNCATE ON policy_decisions FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER admin_actions_no_truncate BEFORE TRUNCATE ON admin_actions FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------------------------------
-- Row-level security on user-owned tables, keyed by app.user_id (TM-17)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE POLICY users_self ON users USING (id = app_current_user_id()) WITH CHECK (id = app_current_user_id());

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['user_auth_methods', 'user_sessions', 'devices', 'wallet_accounts', 'user_preferences', 'profiles', 'consent_records', 'data_requests']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY %I ON %I USING (user_id = app_current_user_id()) WITH CHECK (user_id = app_current_user_id())', t || '_owner', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------------------------
-- Grants (least privilege)
-- ---------------------------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO suiem_app, suiem_system;
GRANT EXECUTE ON FUNCTION app_current_user_id() TO suiem_app, suiem_system;

-- Request-path role: only its own rows (RLS), no deletes on user data, no access to ops tables.
GRANT SELECT ON users TO suiem_app;
GRANT SELECT ON user_auth_methods, user_sessions, devices TO suiem_app;
GRANT SELECT, INSERT, UPDATE ON user_preferences, profiles, wallet_accounts TO suiem_app;
GRANT SELECT, INSERT ON consent_records, data_requests TO suiem_app;
GRANT SELECT ON policy_versions, feature_flags, jurisdiction_policies TO suiem_app;

-- Privileged role: auth, admin, flags, audit, idempotency. Append-only triggers still apply.
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO suiem_system;
GRANT DELETE ON idempotency_keys, outbox_events TO suiem_system;
