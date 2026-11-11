-- 0008_elections (Sprint 7): $WIF burn-to-vote on Robinhood Chain mainnet 4663.
-- Separation (ADR-0005): nothing here references reputation_* and nothing in reputation_* references
-- this. Votes come ONLY from indexed chain events; the API never writes a tally.

-- ---- elections: frozen rules and candidates --------------------------------------------------
ALTER TABLE elections
  ADD COLUMN cap_per_wallet  integer CHECK (cap_per_wallet > 0),
  ADD COLUMN result_status   text NOT NULL DEFAULT 'none' CHECK (result_status IN ('none', 'provisional', 'final')),
  ADD COLUMN create_tx_hash  tx_hash,
  ADD COLUMN is_demo         boolean NOT NULL DEFAULT false;

ALTER TABLE election_candidates
  ADD COLUMN board  text CHECK (board IN ('research', 'investors')),
  ADD COLUMN rank   integer CHECK (rank > 0),
  ADD COLUMN score  numeric(12, 4),
  ADD COLUMN label  text NOT NULL DEFAULT 'ranked' CHECK (label IN ('ranked', 'building_track_record'));

-- Candidates are a snapshot taken at creation: rows can be inserted only while the election is a
-- draft and are never updated or deleted.
CREATE FUNCTION election_candidates_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF (SELECT status FROM elections WHERE id = NEW.election_id) <> 'draft' THEN
      RAISE EXCEPTION 'election candidates are frozen after creation' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'election candidates are frozen: % is not allowed', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER election_candidates_frozen BEFORE INSERT OR UPDATE OR DELETE ON election_candidates
  FOR EACH ROW EXECUTE FUNCTION election_candidates_frozen();

-- Rules, title, times and cap never change once an election has left draft.
CREATE FUNCTION elections_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
       NEW.rules IS DISTINCT FROM OLD.rules OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.starts_at IS DISTINCT FROM OLD.starts_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at
    OR NEW.cap_per_wallet IS DISTINCT FROM OLD.cap_per_wallet OR NEW.category IS DISTINCT FROM OLD.category
    OR NEW.onchain_election_id IS DISTINCT FROM OLD.onchain_election_id
    OR NEW.contract_address IS DISTINCT FROM OLD.contract_address) THEN
    RAISE EXCEPTION 'election % is frozen after creation', OLD.slug USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER elections_frozen BEFORE UPDATE ON elections FOR EACH ROW EXECUTE FUNCTION elections_frozen();
CREATE TRIGGER elections_no_delete BEFORE DELETE ON elections FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE UNIQUE INDEX elections_onchain ON elections (chain_id, contract_address, onchain_election_id)
  WHERE onchain_election_id IS NOT NULL;

-- ---- indexer ---------------------------------------------------------------------------------
CREATE TABLE indexer_cursors (
  chain_id          suiem_chain_id NOT NULL,
  contract_address  evm_address NOT NULL,
  -- Next block to fetch logs from. Blocks below it are indexed (some may still be non-final).
  next_block        bigint NOT NULL CHECK (next_block >= 0),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, contract_address)
);
CREATE INDEX chain_events_contract ON chain_events (chain_id, contract_address, block_number);
-- chain_events rows are never deleted (reorged logs are marked removed).
CREATE TRIGGER chain_events_no_delete BEFORE DELETE ON chain_events FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER chain_events_no_truncate BEFORE TRUNCATE ON chain_events FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- ---- vote previews and tx binding (tallies never come from here) ------------------------------
CREATE TABLE election_vote_previews (
  id                    uuid7 PRIMARY KEY,
  user_id               uuid NOT NULL REFERENCES users (id),
  election_id           uuid NOT NULL REFERENCES elections (id),
  candidate_id          uuid NOT NULL REFERENCES election_candidates (id),
  votes                 integer NOT NULL CHECK (votes > 0),
  wallet                evm_address NOT NULL,
  preview_hash          bytea NOT NULL CHECK (octet_length(preview_hash) = 32),
  created_at            timestamptz NOT NULL DEFAULT now(),
  expires_at            timestamptz NOT NULL
);
CREATE INDEX election_vote_previews_user ON election_vote_previews (user_id, created_at DESC);

CREATE TABLE election_vote_claims (
  id           uuid7 PRIMARY KEY,
  election_id  uuid NOT NULL REFERENCES elections (id),
  user_id      uuid NOT NULL REFERENCES users (id),
  preview_id   uuid NOT NULL REFERENCES election_vote_previews (id),
  wallet       evm_address NOT NULL,
  tx_hash      tx_hash NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX election_vote_claims_user ON election_vote_claims (user_id, created_at DESC);

-- ---- notifications ---------------------------------------------------------------------------
ALTER TABLE notifications DROP CONSTRAINT notifications_kind_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_kind_check CHECK (kind IN (
  'new_follower', 'comment', 'reply', 'helpful', 'thesis_evaluated', 'report_outcome', 'appeal_outcome',
  'election_nominated', 'election_result'));
ALTER TABLE notifications ADD COLUMN election_id uuid REFERENCES elections (id);
CREATE UNIQUE INDEX notifications_election_once ON notifications (user_id, kind, election_id)
  WHERE election_id IS NOT NULL;

-- ---- grants (least privilege for the app role) -----------------------------------------------
GRANT SELECT, INSERT, UPDATE ON indexer_cursors, election_vote_previews, election_vote_claims TO suiem_app;
GRANT INSERT, UPDATE, DELETE ON election_tallies TO suiem_app;
REVOKE DELETE ON chain_events, elections, election_candidates FROM suiem_app;

