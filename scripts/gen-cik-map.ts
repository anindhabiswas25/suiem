// Regenerates packages/shared/src/entities/cik-map.ts from SEC's company_tickers.json.
// Needs SEC_USER_AGENT (SEC fair-access policy). Run: pnpm tsx --env-file=.env scripts/gen-cik-map.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { ENTITY_DICTIONARY } from "../packages/shared/src/entities/dictionary";

const ua = process.env.SEC_USER_AGENT;
if (!ua) throw new Error("SEC_USER_AGENT is required (SEC fair-access policy)");
const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
  headers: { "User-Agent": ua },
});
if (!res.ok) throw new Error(`SEC returned ${res.status}`);
const rows = Object.values(
  (await res.json()) as Record<string, { cik_str: number; ticker: string; title: string }>,
);
const byTicker = new Map(rows.map((r) => [r.ticker.toUpperCase(), r]));
const map: Record<string, { cik: string; ticker: string; title: string }> = {};
for (const e of ENTITY_DICTIONARY) {
  if (e.kind !== "company") continue;
  for (const t of e.tickers) {
    const hit = byTicker.get(t.replace(".", "-")) ?? byTicker.get(t);
    if (hit) {
      map[e.canonicalId] = {
        cik: String(hit.cik_str).padStart(10, "0"),
        ticker: t,
        title: hit.title,
      };
      break;
    }
  }
}
const body = `/**
 * Entity → SEC CIK, generated from https://www.sec.gov/files/company_tickers.json on ${new Date().toISOString().slice(0, 10)}
 * by scripts/gen-cik-map.ts. Static so seeding and CI need no network. Entities without SEC filings are absent.
 */
export const CIK_MAP: Record<string, { cik: string; ticker: string; title: string }> = ${JSON.stringify(map, null, 2)};
`;
writeFileSync(
  join(import.meta.dirname, "..", "packages", "shared", "src", "entities", "cik-map.ts"),
  body,
);
console.log(
  `mapped ${Object.keys(map).length} entities; unmapped companies: ${
    ENTITY_DICTIONARY.filter((e) => e.kind === "company" && !map[e.canonicalId])
      .map((e) => e.slug)
      .join(", ") || "none"
  }`,
);
