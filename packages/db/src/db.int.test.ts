import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { newId } from "@suiem/shared/ids";
import { migrate } from "./migrate";
import * as schema from "./schema";
import { APPEND_ONLY_TABLES } from "./schema";

let db: pg.Client;

async function makeUser(): Promise<string> {
  const id = newId();
  await db.query("INSERT INTO users (id, handle) VALUES ($1, $2)", [id, `u_${id.slice(-12)}`]);
  return id;
}
const entityId = async (slug: string) =>
  (
    await db.query<{ id: string }>("SELECT id FROM entities WHERE canonical_id = $1", [
      `ent:${slug}`,
    ])
  ).rows[0]!.id;

beforeAll(async () => {
  db = new pg.Client({ connectionString: inject("pgUrl") });
  await db.connect();
});
afterAll(async () => {
  await db.end();
});

describe("migrations", () => {
  test("re-running is a no-op, and editing an applied migration is detected", async () => {
    expect((await migrate(inject("pgUrl"))).applied).toEqual([]);
    await db.query(
      "UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '0001_foundation.sql'",
    );
    await expect(migrate(inject("pgUrl"))).rejects.toThrow(/modified after being applied/);
    const real = createHash("sha256")
      .update(
        readFileSync(join(import.meta.dirname, "..", "migrations", "0001_foundation.sql"), "utf8"),
      )
      .digest("hex");
    await db.query(
      "UPDATE schema_migrations SET checksum = $1 WHERE version = '0001_foundation.sql'",
      [real],
    );
  });

  test("every Drizzle table and column exists in the database", async () => {
    const cols = await db.query<{ t: string; c: string }>(
      "SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = 'public'",
    );
    const actual = new Set(cols.rows.map((r) => `${r.t}.${r.c}`));
    let tables = 0;
    for (const value of Object.values(schema)) {
      if (typeof value !== "object" || value === null || !("getSQL" in value)) continue;
      const cfg = getTableConfig(value as PgTable);
      tables += 1;
      for (const c of cfg.columns)
        expect(actual, `${cfg.name}.${c.name}`).toContain(`${cfg.name}.${c.name}`);
    }
    const sqlTables = await db.query(
      "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name <> 'schema_migrations'",
    );
    expect(tables).toBe(sqlTables.rows[0].n);
  });
});

describe("seed", () => {
  test("loads ~40 entities with aliases and 5 unverified testnet Stock Token instruments", async () => {
    const e = await db.query("SELECT count(*)::int AS n FROM entities");
    expect(e.rows[0].n).toBe(40);
    const amb = await db.query("SELECT alias FROM entity_aliases WHERE ambiguous ORDER BY alias");
    expect(amb.rows.map((r) => r.alias)).toEqual(
      expect.arrayContaining(["Apple", "Meta", "V", "Visa"]),
    );
    const i = await db.query(
      "SELECT symbol, status, contract_address, chain_id FROM instruments WHERE legal_type = 'testnet_test_token' ORDER BY symbol",
    );
    expect(i.rows.map((r) => r.symbol)).toEqual([
      "TEST:AMD",
      "TEST:AMZN",
      "TEST:NFLX",
      "TEST:PLTR",
      "TEST:TSLA",
    ]);
    expect(
      i.rows.every(
        (r) => r.status === "unverified" && r.contract_address === null && r.chain_id === 46630,
      ),
    ).toBe(true);
  });
});

describe("conventions", () => {
  test("ids must be UUIDv7", async () => {
    await expect(
      db.query(
        "INSERT INTO users (id, handle) VALUES ('6f1c2d6e-1a2b-4c3d-8e9f-001122334455', 'v4_user')",
      ),
    ).rejects.toThrow(/uuid7/);
  });
  test("the 'live' book is blocked everywhere a book is stored", async () => {
    await expect(db.query("SELECT 'live'::ledger_book")).rejects.toThrow(/ledger_book/);
    const u = await makeUser();
    await expect(
      db.query(
        "INSERT INTO ledger_entries (id, user_id, book, asset, amount, decimals, entry_type) VALUES ($1, $2, 'live', 'USD', 1, 6, 'deposit')",
        [newId(), u],
      ),
    ).rejects.toThrow(/ledger_book/);
  });
  test("token amounts are exact numeric(78,0) strings; fiat is numeric(20,6)", async () => {
    const r = await db.query(
      "SELECT '123456789012345678901234567890123456789012345678901234567890'::token_units AS v, '12.3456789'::fiat_amount AS f",
    );
    expect(r.rows[0]).toEqual({
      v: "123456789012345678901234567890123456789012345678901234567890",
      f: "12.345679",
    });
  });
  test("only chains 4663 and 46630 are storable; addresses are 20 bytes", async () => {
    await expect(db.query("SELECT 1::suiem_chain_id")).rejects.toThrow(/suiem_chain_id/);
    await expect(db.query("SELECT 10143::suiem_chain_id")).rejects.toThrow(/suiem_chain_id/);
    await expect(db.query("SELECT '\\x00'::bytea::evm_address")).rejects.toThrow(/evm_address/);
  });
  test("elections live on mainnet 4663 only", async () => {
    await expect(
      db.query(
        "INSERT INTO elections (id, slug, title, category, chain_id, starts_at, ends_at) VALUES ($1, 'x-test', 'x', 'investor', 46630, now(), now() + interval '1 day')",
        [newId()],
      ),
    ).rejects.toThrow(/elections_chain_id_check/);
    await expect(
      db.query(
        "INSERT INTO elections (id, slug, title, category, chain_id, starts_at, ends_at, status) VALUES ($1, 'y-test', 'y', 'investor', 4663, now(), now() + interval '1 day', 'open')",
        [newId()],
      ),
    ).rejects.toThrow(/check/);
  });
});

describe("instrument registry guards (PRD §8.1, ADR-0004)", () => {
  const insert = (fields: Record<string, unknown>) => {
    const base = {
      id: newId(),
      symbol: `TEST:X${randomBytes(2).toString("hex").toUpperCase()}`,
      display_name: "x",
      network: "testnet",
      chain_id: 46630,
      legal_type: "demo_token",
      decimals: 18,
      status: "unverified",
    };
    const row = { ...base, ...fields };
    const keys = Object.keys(row);
    return db.query(
      `INSERT INTO instruments (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
      Object.values(row),
    );
  };
  test("an onchain instrument cannot be active without address, source and verification time", async () => {
    await expect(insert({ status: "active" })).rejects.toThrow(/check/);
    await expect(
      insert({
        status: "active",
        contract_address: randomBytes(20),
        source_url: "https://x",
        last_verified_at: new Date(),
      }),
    ).resolves.toBeDefined();
  });
  test("no real-security legal types exist; simulated must be off-chain; nothing on mainnet", async () => {
    await expect(insert({ legal_type: "tokenized_equity" })).rejects.toThrow(/legal_type/);
    await expect(insert({ legal_type: "simulated" })).rejects.toThrow(/check/);
    await expect(insert({ network: "mainnet", chain_id: 4663 })).rejects.toThrow(/check/);
    await expect(insert({ symbol: "NVDAx" })).rejects.toThrow(/symbol/);
  });
});

describe("append-only history rejects UPDATE, DELETE and TRUNCATE", () => {
  beforeAll(async () => {
    const u = await makeUser();
    const ent = await entityId("nvidia");
    const thesis = newId();
    await db.query(
      "INSERT INTO consent_records (id, user_id, purpose, policy_version, action) VALUES ($1, $2, 'terms', '2026-11-10.1', 'granted')",
      [newId(), u],
    );
    await db.query("INSERT INTO theses (id, user_id, entity_id) VALUES ($1, $2, $3)", [
      thesis,
      u,
      ent,
    ]);
    await db.query(
      "INSERT INTO thesis_versions (id, thesis_id, version, direction, horizon_days, title, rationale, counterarguments, risks, invalidation) VALUES ($1, $2, 1, 'bullish', 90, 'Test thesis', 'r', 'c', 'k', 'i')",
      [newId(), thesis],
    );
    const inst = (await db.query<{ id: string }>("SELECT id FROM instruments LIMIT 1")).rows[0]!.id;
    const order = newId();
    await db.query(
      `INSERT INTO orders (id, user_id, instrument_id, book, side, status, quote_amount, quote_decimals, quote_asset, est_quantity, quantity_decimals, max_slippage_bps, quote_at, quote_expires_at, preview_hash)
       VALUES ($1, $2, $3, 'simulated', 'buy', 'previewed', 1000000, 6, 'USD', 1, 18, 50, now(), now() + interval '30 seconds', $4)`,
      [order, u, inst, randomBytes(32)],
    );
    await db.query("INSERT INTO order_events (id, order_id, status) VALUES ($1, $2, 'previewed')", [
      newId(),
      order,
    ]);
    await db.query(
      "INSERT INTO ledger_entries (id, user_id, book, asset, amount, decimals, entry_type) VALUES ($1, $2, 'simulated', 'USD', 1, 6, 'deposit')",
      [newId(), u],
    );
    await db.query(
      "INSERT INTO reputation_evidence (id, user_id, component, source_type, source_id, value, methodology_version, observed_at) VALUES ($1, $2, 'research_quality', 'brief', $3, 1, 'v1', now())",
      [newId(), u, newId()],
    );
    await db.query(
      "INSERT INTO audit_logs (id, actor_type, action, outcome) VALUES ($1, 'system', 'test.event', 'success')",
      [newId()],
    );
  });
  for (const table of APPEND_ONLY_TABLES) {
    test(table, async () => {
      expect((await db.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBeGreaterThan(
        0,
      );
      await expect(db.query(`UPDATE ${table} SET id = id`)).rejects.toThrow(/append-only/);
      await expect(db.query(`DELETE FROM ${table}`)).rejects.toThrow(/append-only/);
      await expect(db.query(`TRUNCATE ${table} CASCADE`)).rejects.toThrow(/append-only/);
    });
  }
});

describe("trading.live is hard-off at the database", () => {
  test("enable, upsert, delete and rename are all rejected", async () => {
    await expect(
      db.query("UPDATE feature_flags SET enabled = true WHERE key = 'trading.live'"),
    ).rejects.toThrow(/trading_live_hard_off/);
    await expect(
      db.query(
        "INSERT INTO feature_flags (key, enabled) VALUES ('trading.live', true) ON CONFLICT (key) DO UPDATE SET enabled = true",
      ),
    ).rejects.toThrow(/trading_live_hard_off/);
    await expect(db.query("DELETE FROM feature_flags WHERE key = 'trading.live'")).rejects.toThrow(
      /cannot be deleted or renamed/,
    );
    await expect(
      db.query("UPDATE feature_flags SET key = 'campaigns' WHERE key = 'trading.live'"),
    ).rejects.toThrow(/cannot be deleted or renamed/);
  });
});

describe("indexer and reputation invariants", () => {
  test("chain events are unique on (chain_id, tx_hash, log_index)", async () => {
    const tx = randomBytes(32);
    const row = [4663, randomBytes(20), tx, 0, 1, randomBytes(32), "Voted", "{}", "soft"];
    const sql =
      "INSERT INTO chain_events (id, chain_id, contract_address, tx_hash, log_index, block_number, block_hash, event_name, args, finality) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)";
    await db.query(sql, [newId(), ...row]);
    await expect(db.query(sql, [newId(), ...row])).rejects.toThrow(/duplicate key/);
  });
  test("a 'building' reputation snapshot cannot carry a score", async () => {
    const u = await makeUser();
    await expect(
      db.query(
        "INSERT INTO reputation_snapshots (id, user_id, methodology_version, maturity, suiem_score, components) VALUES ($1, $2, 'v1', 'building', 50, '{}')",
        [newId(), u],
      ),
    ).rejects.toThrow(/check/);
  });
  test("one active owner per wallet address", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    const addr = randomBytes(20);
    const sql =
      "INSERT INTO wallet_accounts (id, user_id, address, chain_id, siwe_message_hash) VALUES ($1, $2, $3, $4, $5)";
    await db.query(sql, [newId(), a, addr, 4663, randomBytes(32)]);
    await expect(db.query(sql, [newId(), b, addr, 46630, randomBytes(32)])).rejects.toThrow(
      /wallet_accounts_active_address/,
    );
  });
});

describe("least-privilege API role (suiem_app)", () => {
  let app: pg.Client;
  beforeAll(async () => {
    app = new pg.Client({ connectionString: inject("pgAppUrl") });
    await app.connect();
  });
  afterAll(async () => {
    await app.end();
  });
  test("is not a superuser and cannot bypass RLS", async () => {
    const r = await app.query(
      "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    );
    expect(r.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
  });
  test("cannot run DDL, change flags, or touch migrations", async () => {
    await expect(app.query("CREATE TABLE x (id int)")).rejects.toThrow(/permission denied/);
    await expect(app.query("DROP TABLE users")).rejects.toThrow(/must be owner|permission denied/);
    await expect(
      app.query("UPDATE feature_flags SET enabled = true WHERE key = 'elections'"),
    ).rejects.toThrow(/permission denied/);
    await expect(app.query("SELECT * FROM schema_migrations")).rejects.toThrow(/permission denied/);
  });
  test("cannot delete user data or rewrite append-only history", async () => {
    await expect(app.query("DELETE FROM users")).rejects.toThrow(/permission denied/);
    await expect(app.query("DELETE FROM orders")).rejects.toThrow(/permission denied/);
    await expect(app.query("UPDATE audit_logs SET action = 'x'")).rejects.toThrow(
      /permission denied/,
    );
    await expect(app.query("TRUNCATE ledger_entries")).rejects.toThrow(/permission denied/);
  });
  test("can do normal reads and writes", async () => {
    const id = newId();
    await app.query("INSERT INTO users (id, handle) VALUES ($1, $2)", [id, `app_${id.slice(-10)}`]);
    await expect(app.query("SELECT handle FROM users WHERE id = $1", [id])).resolves.toMatchObject({
      rowCount: 1,
    });
  });
});
