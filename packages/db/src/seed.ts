import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newId } from "@suiem/shared/ids";
import pg from "pg";
import { DEMO_USERS, SEED_ENTITIES, TESTNET_STOCK_TOKENS } from "./seed-data";
import { CIK_MAP } from "@suiem/shared/entities";

const POLICY_DIR = join(import.meta.dirname, "..", "..", "..", "docs", "policies");
export const INITIAL_POLICY_VERSION = "2026-11-10.1";

export const POLICY_DEFINITIONS = [
  { purpose: "terms", title: "Terms of Service (draft)", summaryUrl: "/help#terms" },
  { purpose: "privacy", title: "Privacy Notice (draft)", summaryUrl: "/help#privacy" },
  {
    purpose: "product_analytics",
    title: "Product analytics (optional)",
    summaryUrl: "/help#consents",
  },
  { purpose: "marketing_email", title: "Product news (optional)", summaryUrl: "/help#consents" },
  {
    purpose: "extension_detection",
    title: "Browser extension detection (Sprint 3)",
    summaryUrl: "/help#consents",
  },
  { purpose: "digest_sync", title: "Daily digest sync (Sprint 3)", summaryUrl: "/help#consents" },
] as const;

/** Idempotent: safe to run repeatedly. Demo users are flagged is_demo and have no login methods. */
export async function seed(url: string): Promise<{ entities: number; instruments: number }> {
  const client = new pg.Client({ connectionString: url, application_name: "suiem-seed" });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const def of POLICY_DEFINITIONS) {
      const sha = createHash("sha256")
        .update(readFileSync(join(POLICY_DIR, `${def.purpose}-${INITIAL_POLICY_VERSION}.md`)))
        .digest();
      await client.query(
        `INSERT INTO policy_versions (id, purpose, version, title, summary_url, content_sha256, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, '2026-11-10T00:00:00Z') ON CONFLICT (purpose, version) DO NOTHING`,
        [newId(), def.purpose, INITIAL_POLICY_VERSION, def.title, def.summaryUrl, sha],
      );
    }
    for (const key of ["trading.live", "trading.testnet", "elections", "campaigns"]) {
      await client.query(
        "INSERT INTO feature_flags (key, enabled) VALUES ($1, false) ON CONFLICT (key) DO NOTHING",
        [key],
      );
    }
    const entityIds = new Map<string, string>();
    for (const e of SEED_ENTITIES) {
      const r = await client.query<{ id: string }>(
        `INSERT INTO entities (id, canonical_id, name, legal_name, kind, sector, country, cik)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (canonical_id) DO UPDATE SET name = EXCLUDED.name, cik = EXCLUDED.cik RETURNING id`,
        [
          newId(),
          e.canonicalId,
          e.name,
          e.legalName,
          e.kind,
          e.sector,
          e.country,
          CIK_MAP[e.canonicalId]?.cik ?? null,
        ],
      );
      const id = r.rows[0]!.id;
      entityIds.set(e.slug, id);
      for (const a of e.aliases) {
        await client.query(
          `INSERT INTO entity_aliases (id, entity_id, alias, alias_type, ambiguous) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (entity_id, alias, alias_type) DO NOTHING`,
          [newId(), id, a.alias, a.type, a.ambiguous],
        );
      }
    }
    for (const t of TESTNET_STOCK_TOKENS) {
      await client.query(
        `INSERT INTO instruments (id, entity_id, symbol, display_name, network, chain_id, legal_type, decimals, status, source_url, notes)
         VALUES ($1, $2, $3, $4, 'testnet', 46630, 'testnet_test_token', 18, 'unverified', 'https://faucet.testnet.chain.robinhood.com', $5)
         ON CONFLICT (symbol) DO NOTHING`,
        [
          newId(),
          entityIds.get(t.entity),
          t.symbol,
          t.name,
          "UNVERIFIED address (VERIFIED_FACTS T-05). Testnet token: no value, not a security, not a share. Decimals to be read onchain in Sprint 5.",
        ],
      );
    }
    for (const u of DEMO_USERS) {
      const r = await client.query<{ id: string }>(
        `INSERT INTO users (id, handle, display_name, is_demo) VALUES ($1, $2, $3, true)
         ON CONFLICT (handle) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
        [newId(), u.handle, u.displayName],
      );
      const id = r.rows[0]!.id;
      await client.query(
        `INSERT INTO user_preferences (user_id, interests, jurisdiction, experience_level, onboarding_completed_at)
         VALUES ($1, $2, $3, 'intermediate', now()) ON CONFLICT (user_id) DO NOTHING`,
        [id, u.interests, u.jurisdiction],
      );
      await client.query(
        "INSERT INTO profiles (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING",
        [id],
      );
    }
    await client.query("COMMIT");
    return { entities: SEED_ENTITIES.length, instruments: TESTNET_STOCK_TOKENS.length };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
