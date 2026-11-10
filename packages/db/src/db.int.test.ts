import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, test } from "vitest";
import { newId } from "@suiem/shared/ids";
import { connect, withUser, type DbHandle } from "./client";
import { migrate } from "./migrate";
import * as schema from "./schema";
import { APPEND_ONLY_TABLES, RLS_TABLES } from "./schema";
import { sql } from "drizzle-orm";

let owner: pg.Client;
let app: DbHandle;
let system: pg.Client;

/** Creates a user with one row in every user-owned table (as owner, bypassing RLS). */
async function makeUser(): Promise<string> {
  const id = newId();
  await owner.query("INSERT INTO users (id, email) VALUES ($1, $2)", [id, `${id}@test.local`]);
  await owner.query(
    "INSERT INTO user_auth_methods (id, user_id, kind) VALUES ($1, $2, 'email_otp')",
    [newId(), id],
  );
  await owner.query(
    "INSERT INTO user_sessions (id, user_id, token_hash, amr, expires_at) VALUES ($1, $2, $3, '{email_otp}', now() + interval '1 day')",
    [newId(), id, randomBytes(32)],
  );
  await owner.query("INSERT INTO devices (id, user_id, kind) VALUES ($1, $2, 'browser')", [
    newId(),
    id,
  ]);
  await owner.query(
    "INSERT INTO wallet_accounts (id, user_id, chain_id, address, kind, siwe_message_hash) VALUES ($1, $2, 46630, $3, 'external_eoa', $4)",
    [newId(), id, randomBytes(20), Buffer.alloc(32, 1)],
  );
  await owner.query("INSERT INTO user_preferences (user_id) VALUES ($1)", [id]);
  await owner.query("INSERT INTO profiles (user_id) VALUES ($1)", [id]);
  await owner.query(
    "INSERT INTO consent_records (id, user_id, purpose, policy_version, action) VALUES ($1, $2, 'terms', '2026-11-10.1', 'granted')",
    [newId(), id],
  );
  await owner.query("INSERT INTO data_requests (id, user_id, type) VALUES ($1, $2, 'export')", [
    newId(),
    id,
  ]);
  return id;
}

/** Drizzle wraps driver errors; the Postgres message is on `cause`. */
const errText = (e: unknown): string => {
  const err = e as { message?: string; cause?: { message?: string } };
  return `${err.message ?? ""} ${err.cause?.message ?? ""}`;
};
async function expectDbError(p: Promise<unknown>, re: RegExp) {
  const e = await p.then(
    () => undefined,
    (err: unknown) => err,
  );
  expect(e, "expected the query to fail").toBeDefined();
  expect(errText(e)).toMatch(re);
}

/** Inserts one row into each append-only table so row triggers have something to fire on. */
async function seedAppendOnlyRows(userId: string) {
  await owner.query(
    "INSERT INTO audit_logs (id, actor_type, action, outcome) VALUES ($1, 'system', 'test.event', 'success')",
    [newId()],
  );
  await owner.query(
    "INSERT INTO policy_decisions (id, policy_version, capability, allowed, reason) VALUES ($1, '2026-11-10.1', 'research', true, 'test')",
    [newId()],
  );
  await owner.query(
    "INSERT INTO admin_actions (id, admin_user_id, action, reason_code, reason_note, outcome) VALUES ($1, $2, 'test.action', 'TEST_ENV', 'test', 'success')",
    [newId(), userId],
  );
}

const ownerColumn = (table: string) => (table === "users" ? "id" : "user_id");

beforeAll(async () => {
  owner = new pg.Client({ connectionString: inject("pgOwnerUrl") });
  await owner.connect();
  system = new pg.Client({ connectionString: inject("pgSystemUrl") });
  await system.connect();
  app = connect(inject("pgAppUrl"));
});

afterAll(async () => {
  await owner.end();
  await system.end();
  await app.close();
});

describe("migrations", () => {
  test("re-running is a no-op, and editing an applied migration is detected", async () => {
    const again = await migrate(inject("pgOwnerUrl"));
    expect(again.applied).toEqual([]);
    await owner.query(
      "UPDATE schema_migrations SET checksum = 'tampered' WHERE version = '0001_foundation.sql'",
    );
    await expect(migrate(inject("pgOwnerUrl"))).rejects.toThrow(/modified after being applied/);
    const { createHash } = await import("node:crypto");
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const real = createHash("sha256")
      .update(
        readFileSync(join(import.meta.dirname, "..", "migrations", "0001_foundation.sql"), "utf8"),
      )
      .digest("hex");
    await owner.query(
      "UPDATE schema_migrations SET checksum = $1 WHERE version = '0001_foundation.sql'",
      [real],
    );
  });

  test("every Drizzle table and column exists in the migrated database", async () => {
    const cols = await owner.query<{ table_name: string; column_name: string }>(
      "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'",
    );
    const actual = new Set(cols.rows.map((r) => `${r.table_name}.${r.column_name}`));
    const { getTableConfig } = await import("drizzle-orm/pg-core");
    for (const value of Object.values(schema)) {
      if (typeof value !== "object" || value === null || !("getSQL" in value)) continue;
      const cfg = getTableConfig(value as Parameters<typeof getTableConfig>[0]);
      for (const c of cfg.columns)
        expect(actual, `${cfg.name}.${c.name}`).toContain(`${cfg.name}.${c.name}`);
    }
  });
});

describe("conventions", () => {
  test("ids must be UUIDv7", async () => {
    await expect(
      owner.query(
        "INSERT INTO users (id, email) VALUES ('6f1c2d6e-1a2b-4c3d-8e9f-001122334455', 'v4@test.local')",
      ),
    ).rejects.toThrow(/uuid7/);
  });

  test("the 'live' book is CHECK-blocked; simulated and testnet are allowed", async () => {
    await expect(owner.query("SELECT 'live'::ledger_book")).rejects.toThrow(/ledger_book/);
    const ok = await owner.query(
      "SELECT 'simulated'::ledger_book AS a, 'testnet'::ledger_book AS b",
    );
    expect(ok.rows[0]).toEqual({ a: "simulated", b: "testnet" });
  });

  test("token amounts are exact numeric(78,0) and come back as strings", async () => {
    const r = await owner.query(
      "SELECT '123456789012345678901234567890123456789012345678901234567890'::token_units AS v",
    );
    expect(r.rows[0].v).toBe("123456789012345678901234567890123456789012345678901234567890");
    await expect(
      owner.query("SELECT '1.5'::numeric::token_units::text AS v"),
    ).resolves.toMatchObject({ rows: [{ v: "2" }] });
  });

  test("fiat is numeric(20,6) with a 3-letter currency", async () => {
    const r = await owner.query("SELECT '12.3456789'::fiat_amount::text AS v");
    expect(r.rows[0].v).toBe("12.345679");
    await expect(owner.query("SELECT 'usd'::currency_code")).rejects.toThrow(/currency_code/);
  });

  test("addresses are 20 bytes and chain_id must be 46630", async () => {
    await expect(owner.query("SELECT '\\x00'::bytea::evm_address")).rejects.toThrow(/evm_address/);
    await expect(owner.query("SELECT 4663::suiem_chain_id")).rejects.toThrow(/suiem_chain_id/);
    await expect(owner.query("SELECT 46630::suiem_chain_id AS c")).resolves.toMatchObject({
      rows: [{ c: 46630 }],
    });
  });
});

describe("append-only tables reject UPDATE, DELETE and TRUNCATE", () => {
  beforeAll(async () => {
    await seedAppendOnlyRows(await makeUser());
  });
  for (const table of APPEND_ONLY_TABLES) {
    test(table, async () => {
      const count = await owner.query(`SELECT count(*)::int AS n FROM ${table}`);
      expect(count.rows[0].n, "table must have rows for row triggers to fire").toBeGreaterThan(0);
      for (const client of [owner, system]) {
        await expect(client.query(`UPDATE ${table} SET id = id`)).rejects.toThrow(
          /append-only|permission denied/,
        );
        await expect(client.query(`DELETE FROM ${table}`)).rejects.toThrow(
          /append-only|permission denied/,
        );
      }
      await expect(owner.query(`TRUNCATE ${table} CASCADE`)).rejects.toThrow(/append-only/);
    });
  }

  test("triggers fire even when rows exist (not only on empty tables)", async () => {
    const u = await makeUser();
    await expect(
      owner.query("UPDATE consent_records SET action = 'withdrawn' WHERE user_id = $1", [u]),
    ).rejects.toThrow(/append-only/);
  });
});

describe("trading.live is hard-off at the database", () => {
  test("UPDATE to enable is rejected by CHECK", async () => {
    for (const client of [owner, system]) {
      await expect(
        client.query("UPDATE feature_flags SET enabled = true WHERE key = 'trading.live'"),
      ).rejects.toThrow(/trading_live_hard_off/);
    }
  });
  test("delete-and-reinsert and rename are rejected", async () => {
    await expect(
      owner.query("DELETE FROM feature_flags WHERE key = 'trading.live'"),
    ).rejects.toThrow(/cannot be deleted or renamed/);
    await expect(
      owner.query("UPDATE feature_flags SET key = 'elections' WHERE key = 'trading.live'"),
    ).rejects.toThrow(/cannot be deleted or renamed/);
    await expect(
      owner.query(
        "INSERT INTO feature_flags (key, enabled) VALUES ('trading.live', true) ON CONFLICT (key) DO UPDATE SET enabled = true",
      ),
    ).rejects.toThrow(/trading_live_hard_off/);
  });
  test("no jurisdiction policy may allow live trading", async () => {
    await expect(
      owner.query(
        "INSERT INTO jurisdiction_policies (version, rules) VALUES ('2099-01-01.1', $1)",
        [
          JSON.stringify({
            default: {},
            undeclared: {},
            jurisdictions: { US: { live_trading: true } },
          }),
        ],
      ),
    ).rejects.toThrow(/jurisdiction_no_live_trading/);
  });
});

describe("row-level security: user A cannot read or modify user B's rows", () => {
  let a: string;
  let b: string;
  beforeAll(async () => {
    a = await makeUser();
    b = await makeUser();
  });

  for (const table of RLS_TABLES) {
    test(`${table}: select is scoped`, async () => {
      const col = ownerColumn(table);
      const rows = await withUser(app.db, a, (tx) =>
        tx.execute(sql.raw(`SELECT ${col} AS owner FROM ${table}`)),
      );
      expect(rows.rows.length).toBeGreaterThan(0);
      expect(rows.rows.every((r) => r.owner === a)).toBe(true);
      const leaked = await withUser(app.db, a, (tx) =>
        tx.execute(
          sql`SELECT count(*)::int AS n FROM ${sql.raw(table)} WHERE ${sql.raw(col)} = ${b}`,
        ),
      );
      expect(leaked.rows[0]?.n).toBe(0);
    });

    test(`${table}: writes into another user's rows are blocked`, async () => {
      const col = ownerColumn(table);
      // UPDATE: either no privilege, or RLS makes B's rows invisible (0 rows affected).
      const upd = await withUser(app.db, a, (tx) =>
        tx.execute(
          sql`UPDATE ${sql.raw(table)} SET ${sql.raw(col)} = ${sql.raw(col)} WHERE ${sql.raw(col)} = ${b}`,
        ),
      ).catch((e: Error) => e);
      if (upd instanceof Error) expect(errText(upd)).toMatch(/permission denied/);
      else expect(upd.rowCount).toBe(0);
      // DELETE is never granted to the app role on user data.
      await expectDbError(
        withUser(app.db, a, (tx) =>
          tx.execute(sql`DELETE FROM ${sql.raw(table)} WHERE ${sql.raw(col)} = ${b}`),
        ),
        /permission denied/,
      );
      // B's rows are untouched.
      const still = await owner.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${col} = $1`, [
        b,
      ]);
      expect(still.rows[0].n).toBeGreaterThan(0);
    });
  }

  test("inserting a row owned by another user is rejected by WITH CHECK", async () => {
    await expectDbError(
      withUser(app.db, a, (tx) =>
        tx.execute(
          sql`INSERT INTO data_requests (id, user_id, type) VALUES (${newId()}, ${b}, 'delete')`,
        ),
      ),
      /row-level security/,
    );
    await expectDbError(
      withUser(app.db, a, (tx) =>
        tx.execute(
          sql`INSERT INTO consent_records (id, user_id, purpose, policy_version, action) VALUES (${newId()}, ${b}, 'marketing_email', '2026-11-10.1', 'granted')`,
        ),
      ),
      /row-level security/,
    );
  });

  test("without app.user_id the app role sees nothing", async () => {
    const r = await app.pool.query("SELECT count(*)::int AS n FROM users");
    expect(r.rows[0].n).toBe(0);
  });

  test("the app role cannot read operational tables at all", async () => {
    for (const t of [
      "audit_logs",
      "admin_roles",
      "admin_actions",
      "dual_control_requests",
      "idempotency_keys",
      "outbox_events",
      "policy_decisions",
    ]) {
      await expect(app.pool.query(`SELECT 1 FROM ${t} LIMIT 1`)).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  test("the system role bypasses RLS (used only by privileged modules)", async () => {
    const r = await system.query("SELECT count(*)::int AS n FROM users WHERE id = ANY($1)", [
      [a, b],
    ]);
    expect(r.rows[0].n).toBe(2);
  });
});

describe("dual control constraint", () => {
  test("the approver must differ from the requester", async () => {
    const u = await makeUser();
    const id = newId();
    await owner.query(
      `INSERT INTO dual_control_requests (id, action, payload, requested_by, reason_code, reason_note, expires_at)
       VALUES ($1, 'feature_flag.set', '{}', $2, 'TEST_ENV', 'test', now() + interval '1 day')`,
      [id, u],
    );
    await expect(
      owner.query(
        "UPDATE dual_control_requests SET status = 'approved', decided_by = requested_by, decided_at = now() WHERE id = $1",
        [id],
      ),
    ).rejects.toThrow(/dual_control_distinct_approver/);
  });
});
