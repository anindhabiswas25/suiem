-- 0005_invest: testnet demo venue orders, reconciliation and the three books (Sprint 5).

-- Orders carry the signed quote and exactly what the user must sign (bound by preview_hash).
ALTER TABLE orders
  ADD COLUMN trader          evm_address,
  ADD COLUMN venue           evm_address,
  ADD COLUMN quote_nonce     numeric(78, 0),
  ADD COLUMN quote_price     token_units,
  ADD COLUMN price_decimals  token_decimals,
  ADD COLUMN min_out         token_units,
  ADD COLUMN fee_bps         integer CHECK (fee_bps BETWEEN 0 AND 100),
  ADD COLUMN calldata        bytea,
  ADD COLUMN quote_source    jsonb,
  ADD COLUMN failure_reason  text CHECK (length(failure_reason) <= 300),
  ADD COLUMN confirmed_at    timestamptz,
  ADD COLUMN filled_quantity token_units,
  ADD COLUMN filled_amount   token_units;
CREATE UNIQUE INDEX orders_quote_nonce_unique ON orders (quote_nonce) WHERE quote_nonce IS NOT NULL;
CREATE INDEX orders_user ON orders (user_id, created_at DESC);
ALTER TABLE orders ADD CONSTRAINT orders_testnet_fields CHECK (
  book::text <> 'testnet' OR (trader IS NOT NULL AND venue IS NOT NULL AND quote_nonce IS NOT NULL AND calldata IS NOT NULL)
);

-- One fill per order in this sprint (no partial fills): duplicate callbacks/events are no-ops.
CREATE UNIQUE INDEX fills_one_per_order ON fills (order_id);
-- Ledger entries are written once per order, entry type and asset.
CREATE UNIQUE INDEX ledger_entries_once ON ledger_entries (order_id, entry_type, asset) WHERE order_id IS NOT NULL;
