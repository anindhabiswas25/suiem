import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newId } from "@suiem/shared/ids";
import pg from "pg";
import { DEMO_POSTS, DEMO_USERS, SEED_ENTITIES, TESTNET_STOCK_TOKENS } from "./seed-data";
import { CIK_MAP } from "@suiem/shared/entities";
import {
  explorerTx,
  FAUCET_TRACE_TX,
  TESTNET_FAUCET_CONTRACT,
  TESTNET_FAUCET_TOKENS,
} from "@suiem/shared/invest";
import { loadDemoDeployment } from "@suiem/chain/deployment";

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
    // Testnet faucet Stock Tokens: VERIFIED by tracing faucet mints (VERIFIED_FACTS T-05/T-06).
    for (const t of TESTNET_STOCK_TOKENS) {
      const f = TESTNET_FAUCET_TOKENS[t.ticker];
      await client.query(
        `INSERT INTO instruments (id, entity_id, symbol, display_name, network, chain_id, legal_type, contract_address, decimals, status, source_url, last_verified_at, notes)
         VALUES ($1, $2, $3, $4, 'testnet', 46630, 'testnet_test_token', $5, 18, 'active', $6, '2026-11-11T07:00:00Z', $7)
         ON CONFLICT (symbol) DO UPDATE SET contract_address = EXCLUDED.contract_address, status = 'active', source_url = EXCLUDED.source_url,
           last_verified_at = EXCLUDED.last_verified_at, notes = EXCLUDED.notes`,
        [
          newId(),
          entityIds.get(t.entity),
          t.symbol,
          t.name,
          Buffer.from(f.address.slice(2), "hex"),
          explorerTx(FAUCET_TRACE_TX),
          `Verified 2026-11-11: minted by the testnet faucet contract ${TESTNET_FAUCET_CONTRACT} (VERIFIED_FACTS T-05). Testnet token: no value, not a security, not a share. Read-only in Suiem.`,
        ],
      );
    }
    // Suiem demo tokens (dTSLA…): active only once the venue is deployed (deployments/46630.json).
    const deployment = loadDemoDeployment(process.env.DEMO_DEPLOYMENT_FILE);
    for (const t of TESTNET_STOCK_TOKENS) {
      const address = deployment?.tokens[t.ticker];
      await client.query(
        `INSERT INTO instruments (id, entity_id, symbol, display_name, network, chain_id, legal_type, contract_address, decimals, status, source_url, last_verified_at, notes)
         VALUES ($1, $2, $3, $4, 'testnet', 46630, 'demo_token', $5, 18, $6, $7, $8, $9)
         ON CONFLICT (symbol) DO UPDATE SET contract_address = EXCLUDED.contract_address, status = EXCLUDED.status,
           source_url = EXCLUDED.source_url, last_verified_at = EXCLUDED.last_verified_at`,
        [
          newId(),
          entityIds.get(t.entity),
          `DEMO:${t.ticker}`,
          `Suiem Demo ${t.ticker} (testnet, no value)`,
          address ? Buffer.from(address.slice(2), "hex") : null,
          address ? "active" : "unverified",
          address ? `${deployment!.explorer}/address/${address}` : null,
          address ? deployment!.deployedAt : null,
          "Suiem demo token d" +
            t.ticker +
            " traded for dUSD on SuiemDemoVenue (testnet 46630). No value, not a share, not a security.",
        ],
      );
    }
    // Simulated (paper) instruments for every listed company in the registry.
    for (const [canonicalId, m] of Object.entries(CIK_MAP)) {
      const ent = SEED_ENTITIES.find((e) => e.canonicalId === canonicalId);
      if (!ent) continue;
      await client.query(
        `INSERT INTO instruments (id, entity_id, symbol, display_name, network, chain_id, legal_type, decimals, status, notes)
         VALUES ($1, $2, $3, $4, 'offchain', NULL, 'simulated', 18, 'active', 'Paper trading at Finnhub quotes. Nothing is bought.')
         ON CONFLICT (symbol) DO NOTHING`,
        [
          newId(),
          entityIds.get(ent.slug),
          `SIM:${m.ticker.replace(/[^A-Z0-9.]/g, "")}`,
          `${ent.name} (simulated)`,
        ],
      );
    }
    const demoIds = new Map<string, string>();
    for (const u of DEMO_USERS) {
      const r = await client.query<{ id: string }>(
        `INSERT INTO users (id, handle, display_name, is_demo) VALUES ($1, $2, $3, true)
         ON CONFLICT (handle) DO UPDATE SET display_name = EXCLUDED.display_name RETURNING id`,
        [newId(), u.handle, u.displayName],
      );
      const id = r.rows[0]!.id;
      demoIds.set(u.handle, id);
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
    await seedDemoPosts(client, demoIds, entityIds);
    await client.query("COMMIT");
    const n = await client.query<{ n: number }>("SELECT count(*)::int AS n FROM instruments");
    return { entities: SEED_ENTITIES.length, instruments: n.rows[0]!.n };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

/** Demo creator posts, comments and helpful marks. Idempotent: a post is matched by author + body. */
async function seedDemoPosts(
  client: pg.Client,
  users: Map<string, string>,
  entities: Map<string, string>,
): Promise<void> {
  for (const p of DEMO_POSTS) {
    const author = users.get(p.author)!;
    const existing = await client.query<{ id: string }>(
      "SELECT id FROM posts WHERE user_id = $1 AND body = $2",
      [author, p.body],
    );
    if (existing.rows[0]) continue;
    const postId = newId();
    const createdAt = new Date(Date.now() - p.hoursAgo * 3_600_000);
    await client.query(
      `INSERT INTO posts (id, user_id, kind, body, entity_id, visibility, sourced, created_at)
       VALUES ($1, $2, $3, $4, $5, 'public', $6, $7)`,
      [
        postId,
        author,
        p.kind,
        p.body,
        p.entity ? (entities.get(p.entity) ?? null) : null,
        p.sourced ?? false,
        createdAt,
      ],
    );
    for (const [i, c] of (p.comments ?? []).entries()) {
      await client.query(
        `INSERT INTO comments (id, post_id, user_id, body, created_at) VALUES ($1, $2, $3, $4, $5)`,
        [
          newId(),
          postId,
          users.get(c.author)!,
          c.body,
          new Date(createdAt.getTime() + (i + 1) * 600_000),
        ],
      );
    }
    for (const h of p.helpfulFrom ?? []) {
      await client.query(
        `INSERT INTO reactions (post_id, user_id, kind) VALUES ($1, $2, 'helpful') ON CONFLICT DO NOTHING`,
        [postId, users.get(h)!],
      );
    }
  }
}
