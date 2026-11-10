-- 0002_app_role: least-privilege role for the API (security review follow-up, ADR-0010 §5 note).
-- Migrations and seed run as the schema owner; the API connects as suiem_app, which is
-- NOSUPERUSER/NOBYPASSRLS, owns nothing and gets only the DML it needs. Full RLS stays deferred.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'suiem_app') THEN
    CREATE ROLE suiem_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO suiem_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO suiem_app;

-- Rows the product legitimately deletes.
GRANT DELETE ON follows, reactions, bookmarks, watchlist_items, idempotency_keys TO suiem_app;

-- Append-only history: insert and read only (triggers also block mutation).
REVOKE UPDATE ON consent_records, thesis_versions, order_events, ledger_entries, reputation_evidence, audit_logs, policy_versions FROM suiem_app;

-- Reference/config tables are read-only for the API.
REVOKE INSERT, UPDATE ON feature_flags, policy_versions, schema_migrations FROM suiem_app;
REVOKE ALL ON schema_migrations FROM suiem_app;
