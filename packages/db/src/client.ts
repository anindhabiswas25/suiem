import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface DbHandle {
  db: Db;
  pool: pg.Pool;
  close(): Promise<void>;
}

// numeric/bigint come back as strings; never let pg coerce them to JS numbers.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => v);
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => v);

export function connect(
  url: string,
  options: { max?: number; applicationName?: string } = {},
): DbHandle {
  const pool = new pg.Pool({
    connectionString: url,
    max: options.max ?? 10,
    application_name: options.applicationName ?? "suiem",
  });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` in a transaction scoped to one user. RLS policies read `app.user_id`, so every
 * query through `tx` can only see and write that user's rows (ARCHITECTURE §6, TM-17).
 * Use with the RLS-enforced app role (DATABASE_URL), never the system role.
 */
export async function withUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!UUID_RE.test(userId)) throw new Error("withUser requires a UUID");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
    return fn(tx);
  });
}
