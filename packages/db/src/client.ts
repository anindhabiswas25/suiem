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

/**
 * Hackathon build: one application role. Every user-owned query must filter by the session's
 * user id in its repository (full RLS deferred, ADR-0010 §5).
 */
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
