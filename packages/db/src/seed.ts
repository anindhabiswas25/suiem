import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { newId } from "@suiem/shared/ids";
import pg from "pg";
import type { JurisdictionRules } from "./schema";

const POLICY_DIR = join(import.meta.dirname, "..", "..", "..", "docs", "policies");

export const INITIAL_POLICY_VERSION = "2026-11-10.1";

export const POLICY_DEFINITIONS = [
  { purpose: "terms", title: "Terms of Service (draft)", summaryUrl: "/legal/terms" },
  { purpose: "privacy", title: "Privacy Notice (draft)", summaryUrl: "/legal/privacy" },
  {
    purpose: "product_analytics",
    title: "Product analytics (optional)",
    summaryUrl: "/legal/consents#product_analytics",
  },
  {
    purpose: "marketing_email",
    title: "Product news by email (optional)",
    summaryUrl: "/legal/consents#marketing_email",
  },
  {
    purpose: "extension_detection",
    title: "Browser extension detection (Phase 3)",
    summaryUrl: "/legal/consents#extension_detection",
  },
  {
    purpose: "digest_sync",
    title: "Daily digest sync (Phase 3)",
    summaryUrl: "/legal/consents#digest_sync",
  },
] as const;

/**
 * Jurisdiction policy v1 (PRD §17, ADR-0001 §5).
 * - Live trading is denied everywhere (and the DB CHECK forbids ever allowing it).
 * - India (IN): research, education and simulation only (PO brief, Phase 2).
 * - Undeclared jurisdiction: research and education only until the user declares one.
 */
export const INITIAL_JURISDICTION_RULES: JurisdictionRules = {
  default: {
    research: true,
    education: true,
    social: true,
    simulated_trading: true,
    live_trading: false,
    elections: true,
    campaigns: true,
  },
  undeclared: {
    research: true,
    education: true,
    social: false,
    simulated_trading: false,
    live_trading: false,
    elections: false,
    campaigns: false,
  },
  jurisdictions: {
    IN: {
      research: true,
      education: true,
      social: false,
      simulated_trading: true,
      live_trading: false,
      elections: false,
      campaigns: false,
    },
  },
};

export const DEV_ADMINS = ["admin1@suiem.local", "admin2@suiem.local"] as const;

export interface SeedOptions {
  /** Creates the two dev admins (ADR-0010 single-maintainer mode). Refused in production. */
  devAdmins: boolean;
  nodeEnv?: string;
}

export async function seed(ownerUrl: string, options: SeedOptions): Promise<void> {
  if (options.devAdmins && options.nodeEnv === "production") {
    throw new Error("Refusing to seed dev admins in production (ADR-0010)");
  }
  const client = new pg.Client({ connectionString: ownerUrl, application_name: "suiem-seed" });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const def of POLICY_DEFINITIONS) {
      const file = join(POLICY_DIR, `${def.purpose}-${INITIAL_POLICY_VERSION}.md`);
      const sha = createHash("sha256").update(readFileSync(file)).digest();
      await client.query(
        `INSERT INTO policy_versions (id, purpose, version, title, summary_url, content_sha256, published_at)
         VALUES ($1, $2, $3, $4, $5, $6, '2026-11-10T00:00:00Z')
         ON CONFLICT (purpose, version) DO NOTHING`,
        [newId(), def.purpose, INITIAL_POLICY_VERSION, def.title, def.summaryUrl, sha],
      );
    }
    for (const key of ["trading.live", "trading.simulated", "elections", "campaigns"]) {
      await client.query(
        "INSERT INTO feature_flags (key, enabled) VALUES ($1, false) ON CONFLICT (key) DO NOTHING",
        [key],
      );
    }
    await client.query(
      `INSERT INTO jurisdiction_policies (version, rules) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
      [INITIAL_POLICY_VERSION, JSON.stringify(INITIAL_JURISDICTION_RULES)],
    );
    if (options.devAdmins) {
      for (const email of DEV_ADMINS) {
        const existing = await client.query<{ id: string }>(
          "SELECT id FROM users WHERE email = $1",
          [email],
        );
        let userId = existing.rows[0]?.id;
        if (userId === undefined) {
          userId = newId();
          await client.query("INSERT INTO users (id, email) VALUES ($1, $2)", [userId, email]);
          await client.query(
            "INSERT INTO user_auth_methods (id, user_id, kind) VALUES ($1, $2, 'email_otp')",
            [newId(), userId],
          );
          await client.query(
            "INSERT INTO profiles (user_id, display_name, jurisdiction) VALUES ($1, $2, 'ZZ')",
            [userId, email.split("@")[0]],
          );
          await client.query("INSERT INTO user_preferences (user_id) VALUES ($1)", [userId]);
        }
        await client.query(
          `INSERT INTO admin_roles (id, user_id, role) SELECT $1, $2, 'superadmin'
           WHERE NOT EXISTS (SELECT 1 FROM admin_roles WHERE user_id = $2 AND role = 'superadmin' AND revoked_at IS NULL)`,
          [newId(), userId],
        );
      }
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}
