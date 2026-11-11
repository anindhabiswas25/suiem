// Live smoke test (manual, never in CI): real EDGAR + Finnhub + Groq/Gemini calls with keys from .env.
// Prints only status, model used, section counts and source count. Never prints keys or full text.
// Usage: pnpm research:smoke ent:nvidia [--only=gemini]
import { loadApiEnv } from "@suiem/config/env";
import { CIK_MAP, ENTITY_DICTIONARY } from "@suiem/shared/entities";
import { researchBriefV1 } from "@suiem/shared/research";
import { researchProviders } from "../factory";
import { MemoryCache } from "../providers/cache";
import { generateBrief, ResearchFailure, type ResolvedEntity } from "../pipeline";
import { NARRATIVE_SECTIONS } from "../prompt";
import { MemoryQuota } from "../quota";

const id = process.argv.slice(2).find((a) => a.startsWith("ent:")) ?? "ent:nvidia";
const env = loadApiEnv({ NODE_ENV: "development", ...process.env });
if (!env.SEC_USER_AGENT) {
  console.log("STOP: SEC_USER_AGENT is not set in .env (the SEC requires it). Ask the PO for it.");
  process.exit(2);
}
const e = ENTITY_DICTIONARY.find((x) => x.canonicalId === id);
if (!e) {
  console.log(`unknown entity ${id}`);
  process.exit(2);
}
const entity: ResolvedEntity = {
  id: "00000000-0000-7000-8000-000000000000",
  canonicalId: e.canonicalId,
  name: e.name,
  kind: e.kind,
  ticker: CIK_MAP[id]?.ticker ?? e.tickers[0] ?? null,
  cik: CIK_MAP[id]?.cik ?? null,
};
const p = researchProviders(env, null, new MemoryCache());
// --only=groq | --only=gemini exercises one provider (e.g. to check the fallback model live).
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7);
if (only) p.models = p.models.filter((m) => m.provider === only);
const events: string[] = [];
const started = Date.now();
try {
  const g = await generateBrief(
    {
      db: null as never,
      filings: p.filings,
      market: p.market,
      models: p.models,
      quota: new MemoryQuota(),
      dailyLimit: 10,
      cacheTtlMs: 0,
      now: () => new Date(),
      log: (ev) => events.push(ev),
    },
    entity,
    null,
  );
  const b = g.brief;
  console.log(
    JSON.stringify(
      {
        entity: id,
        status: "completed",
        valid: researchBriefV1.safeParse(b).success,
        provider: g.model.provider,
        model: g.model.model,
        attemptsBeforeSuccess: g.attempts,
        dataFreshness: b.dataFreshness,
        sources: b.sources.length,
        sourceKinds: g.pack.reduce<Record<string, number>>(
          (m, s) => ((m[s.kind] = (m[s.kind] ?? 0) + 1), m),
          {},
        ),
        sections: {
          summaryWords: b.summary.split(/\s+/).length,
          financialHighlights: b.financialHighlights.length,
          valuation: b.valuation.length,
          ...Object.fromEntries(NARRATIVE_SECTIONS.map((s) => [s, b[s].length])),
          openQuestions: b.openQuestions.length,
        },
        seconds: Math.round((Date.now() - started) / 100) / 10,
      },
      null,
      2,
    ),
  );
} catch (err) {
  console.log(
    JSON.stringify(
      {
        entity: id,
        status: "failed",
        reason: err instanceof ResearchFailure ? err.reason : (err as Error).name,
        attempts: err instanceof ResearchFailure ? err.detail : [],
      },
      null,
      2,
    ),
  );
  process.exit(1);
}
