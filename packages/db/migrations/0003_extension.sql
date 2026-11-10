-- 0003_extension: Suiem Intelligence pairing, device tokens and research requests (Sprint 3).
-- (The sprint brief calls this 0002_extension; 0002 was already used by the app-role migration.)

-- A browser extension paired to an account. Only an HMAC of the device token is stored.
CREATE TABLE extension_installations (
  id            uuid7 PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES users (id),
  token_hash    bytea NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
  label         text CHECK (length(label) <= 60),
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz,
  revoked_at    timestamptz
);
CREATE INDEX extension_installations_user ON extension_installations (user_id);

-- One-time pairing codes: hashed, 5-minute TTL, single use.
CREATE TABLE extension_pairing_codes (
  code_hash   bytea PRIMARY KEY CHECK (octet_length(code_hash) = 32),
  user_id     uuid NOT NULL REFERENCES users (id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  CHECK (expires_at > created_at)
);

-- User-confirmed research requests from the extension. Sprint 4 turns them into briefs.
CREATE TABLE research_requests (
  id               uuid7 PRIMARY KEY,
  user_id          uuid NOT NULL REFERENCES users (id),
  entity_id        uuid NOT NULL REFERENCES entities (id),
  installation_id  uuid REFERENCES extension_installations (id),
  source_url       text NOT NULL CHECK (source_url ~ '^https?://' AND length(source_url) <= 2048),
  -- Only present if the user explicitly chose to include their selected text.
  excerpt          text CHECK (length(excerpt) <= 2000),
  status           text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  brief_id         uuid REFERENCES research_briefs (id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX research_requests_user ON research_requests (user_id, created_at DESC);
CREATE TRIGGER research_requests_touch BEFORE UPDATE ON research_requests FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Least privilege for the API role (as in 0002).
GRANT SELECT, INSERT, UPDATE ON extension_installations, extension_pairing_codes, research_requests TO suiem_app;
-- "Delete all extension activity" (DELETE /extension/activity) removes the user's research requests.
GRANT DELETE ON research_requests TO suiem_app;
