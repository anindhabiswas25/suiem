import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

export const MIGRATIONS_DIR = join(import.meta.dirname, "..", "migrations");

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

/**
 * Applies plain-SQL migrations in filename order, one transaction each. Recorded checksums
 * make an edited, already-applied migration fail loudly instead of drifting.
 */
export async function migrate(
  ownerUrl: string,
  dir: string = MIGRATIONS_DIR,
): Promise<MigrationResult> {
  const client = new pg.Client({ connectionString: ownerUrl, application_name: "suiem-migrate" });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    await client.query("SELECT pg_advisory_lock(727011)");
    const done = new Map(
      (
        await client.query<{ version: string; checksum: string }>(
          "SELECT version, checksum FROM schema_migrations",
        )
      ).rows.map((r) => [r.version, r.checksum]),
    );
    const files = readdirSync(dir)
      .filter((f) => /^\d{4}_.+\.sql$/.test(f))
      .sort();
    const result: MigrationResult = { applied: [], skipped: [] };
    for (const file of files) {
      const sql = readFileSync(join(dir, file), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const existing = done.get(file);
      if (existing !== undefined) {
        if (existing !== checksum)
          throw new Error(`Migration ${file} was modified after being applied`);
        result.skipped.push(file);
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", [
          file,
          checksum,
        ]);
        await client.query("COMMIT");
        result.applied.push(file);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
    }
    return result;
  } finally {
    await client.query("SELECT pg_advisory_unlock(727011)").catch(() => undefined);
    await client.end();
  }
}
