import { type DbHandle, schema } from "@suiem/db";
import { CIK_MAP } from "@suiem/shared/entities";
import { newId } from "@suiem/shared/ids";
import { BRIEF_SCHEMA_VERSION, type ResearchBriefV1 } from "@suiem/shared/research";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { computeHighlights, freshness, valuationFigures } from "./figures";
import { validateBrief } from "./guard";
import { type GenerateInput, ModelError, type ResearchModel } from "./models/types";
import {
  NARRATIVE_SECTIONS,
  narrativeJsonSchema,
  narrativeOutput,
  PROMPT_VERSION,
  RESEARCH_SYSTEM,
  researchUserPrompt,
} from "./prompt";
import type { FilingsProvider, MarketDataProvider } from "./providers/types";
import { type Quota, TOKEN_BUDGET } from "./quota";
import { buildSourcePack, type PackSource, type Retrieved } from "./sourcepack";

export interface PipelineDeps {
  db: DbHandle;
  filings: FilingsProvider | null;
  market: MarketDataProvider | null;
  /** In fallback order: primary first. */
  models: ResearchModel[];
  quota: Quota;
  dailyLimit: number;
  cacheTtlMs: number;
  now: () => Date;
  /** Structured log sink. Never receives excerpts, keys or full text. */
  log: (event: string, fields: Record<string, unknown>) => void;
}

export interface ResolvedEntity {
  id: string;
  canonicalId: string;
  name: string;
  kind: string;
  ticker: string | null;
  cik: string | null;
}

/** User-safe failure (shown in the UI); `detail` is for logs only (no secrets, no text). */
export class ResearchFailure extends Error {
  constructor(
    readonly reason: string,
    readonly detail: string[] = [],
    /** True once any model call returned (tokens were spent): the user's quota slot is kept. */
    readonly tokensSpent = false,
  ) {
    super(reason);
    this.name = "ResearchFailure";
  }
}

export const LIMIT_REACHED = (limit: number) =>
  `Daily research limit reached (${limit} briefs per day). It resets at 00:00 UTC.`;

// ---- Step 1: resolve ---------------------------------------------------------------------
export async function resolveEntity(
  db: DbHandle,
  where: { id: string } | { canonicalId: string },
): Promise<ResolvedEntity | null> {
  const e = (
    await db.db
      .select()
      .from(schema.entities)
      .where(
        "id" in where
          ? eq(schema.entities.id, where.id)
          : eq(schema.entities.canonicalId, where.canonicalId),
      )
  )[0];
  if (!e) return null;
  const tickers = await db.db
    .select({ alias: schema.entityAliases.alias })
    .from(schema.entityAliases)
    .where(
      and(eq(schema.entityAliases.entityId, e.id), eq(schema.entityAliases.aliasType, "ticker")),
    );
  const mapped = CIK_MAP[e.canonicalId];
  return {
    id: e.id,
    canonicalId: e.canonicalId,
    name: e.name,
    kind: e.kind,
    ticker: mapped?.ticker ?? (e.kind === "company" ? (tickers[0]?.alias ?? null) : null),
    cik: e.cik ?? mapped?.cik ?? null,
  };
}

// ---- Steps 2–3: retrieve and normalize ---------------------------------------------------
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export async function retrieve(
  deps: Pick<PipelineDeps, "filings" | "market" | "now">,
  entity: ResolvedEntity,
  opts: { news?: boolean } = {},
): Promise<Retrieved> {
  const missing: string[] = [];
  const attempt = async <T>(label: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch {
      missing.push(`${label} unavailable`);
      return null;
    }
  };
  const r: Retrieved = {
    entity: {
      canonicalId: entity.canonicalId,
      name: entity.name,
      ticker: entity.ticker,
      cik: entity.cik,
    },
    highlights: null,
    financialsRetrievedAt: null,
    filings: null,
    profile: null,
    quote: null,
    peers: [],
    valuation: [],
    marketRetrievedAt: null,
    news: null,
    missing,
  };
  if (entity.cik && deps.filings) {
    const facts = await attempt("SEC financial data", () =>
      deps.filings!.companyFacts(entity.cik!),
    );
    if (facts) {
      r.highlights = computeHighlights(entity.cik, facts.data);
      r.financialsRetrievedAt = facts.retrievedAt;
      missing.push(...r.highlights.missing);
    }
    r.filings = await attempt("SEC filing list", () => deps.filings!.recentFilings(entity.cik!));
  } else missing.push(entity.cik ? "SEC EDGAR not configured" : "No SEC filings for this entity");

  if (entity.ticker && deps.market) {
    const t = entity.ticker;
    r.profile = await attempt("Company profile", () => deps.market!.profile(t));
    r.quote = await attempt("Quote", () => deps.market!.quote(t));
    const peers = await attempt("Peers", () => deps.market!.peers(t));
    r.peers = (peers?.data ?? []).filter((p) => p !== t).slice(0, 6);
    const metrics = await attempt("Valuation metrics", () => deps.market!.metrics(t));
    if (metrics) {
      r.valuation = valuationFigures(metrics.data, metrics.retrievedAt);
      r.marketRetrievedAt = metrics.retrievedAt;
    }
    if (opts.news !== false) {
      const now = deps.now();
      r.news = await attempt("News", () =>
        deps.market!.news(t, ymd(new Date(now.getTime() - 30 * 86_400_000)), ymd(now)),
      );
    }
  } else missing.push(entity.ticker ? "Market data provider not configured" : "No listed ticker");
  return r;
}

// ---- Step 5: generate with retry and fallback --------------------------------------------
export type Check<T> = (json: unknown, model: ResearchModel) => { ok: T } | { errors: string[] };

export async function runModels<T>(
  deps: Pick<PipelineDeps, "models" | "quota" | "now" | "log">,
  task: string,
  build: (errors: string[]) => GenerateInput,
  check: Check<T>,
): Promise<{ value: T; model: ResearchModel; attempts: string[] }> {
  const attempts: string[] = [];
  let sawValidation = false;
  let spent = false;
  for (const model of deps.models) {
    if (
      (await deps.quota.tokensUsed(model.provider, deps.now())) >=
      (TOKEN_BUDGET[model.provider] ?? 0)
    ) {
      attempts.push(`${model.provider}: daily token budget reached`);
      continue;
    }
    let errors: string[] = [];
    let next = false;
    for (let attempt = 0; attempt < 2 && !next; attempt++) {
      try {
        const out = await model.generate(build(errors));
        spent = true;
        await deps.quota.addTokens(model.provider, out.tokens, deps.now());
        const res = check(out.json, model);
        if ("ok" in res) {
          deps.log("research.generated", {
            task,
            provider: model.provider,
            model: model.model,
            attempt: attempt + 1,
          });
          return { value: res.ok, model, attempts };
        }
        errors = res.errors;
        sawValidation = true;
        attempts.push(`${model.provider}#${attempt + 1}: ${errors.length} validation error(s)`);
      } catch (e) {
        if (!(e instanceof ModelError)) throw e;
        attempts.push(`${model.provider}#${attempt + 1}: ${e.kind}`);
        if (e.kind === "bad_output") {
          spent = true; // the provider answered (tokens were used), even though the JSON was unusable
          errors = ["the output was not valid JSON for the schema"];
          sawValidation = true;
        } else next = true; // 429 / 5xx / timeout / config → fall back immediately
      }
    }
  }
  deps.log("research.failed", { task, attempts });
  throw new ResearchFailure(
    sawValidation
      ? "The AI output did not pass Suiem's citation and safety checks, so nothing was saved. Please try again."
      : "The AI providers are busy or at their free-tier limits right now. Please try again later.",
    attempts,
    spent,
  );
}

// ---- Step 4 + assembly -------------------------------------------------------------------
export const DISCLAIMER =
  "AI-generated from the cited public sources, for education only. Not investment advice. Financial figures are computed by Suiem from SEC filings and Finnhub data, not by the AI.";

export function assembleBrief(
  narrative: unknown,
  r: Retrieved,
  pack: PackSource[],
  ids: { financials?: string; market?: string },
  model: { model: string; provider: string },
  generatedAt: Date,
): { brief: ResearchBriefV1 } | { errors: string[] } {
  const parsed = narrativeOutput.safeParse(narrative);
  if (!parsed.success)
    return {
      errors: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  const n = parsed.data;
  let c = 0;
  const cid = () => `c${++c}`;
  const fig = (f: (typeof r.valuation)[number], sid: string) => ({
    id: cid(),
    text: f.text,
    kind: "fact" as const,
    sourceIds: [sid],
    metric: f.metric,
    value: f.value,
    unit: f.unit,
    currency: f.currency,
    period: f.period.slice(0, 40),
    asOf: f.asOf,
    basis: f.basis,
    formula: f.formula ? f.formula.slice(0, 200) : null,
  });
  const brief = {
    schemaVersion: BRIEF_SCHEMA_VERSION,
    entity: {
      canonicalId: r.entity.canonicalId,
      name: r.entity.name,
      ticker: r.entity.ticker,
      instrumentId: null,
    },
    summary: n.summary.trim().slice(0, 2000),
    financialHighlights: ids.financials
      ? (r.highlights?.figures ?? []).map((f) => fig(f, ids.financials!))
      : [],
    valuation: ids.market ? r.valuation.map((f) => fig(f, ids.market!)) : [],
    ...Object.fromEntries(
      NARRATIVE_SECTIONS.map((s) => [
        s,
        n[s].slice(0, 6).map((claim) => ({
          id: cid(),
          text: claim.text.trim().slice(0, 1000),
          kind: claim.kind,
          sourceIds: [...new Set(claim.sourceIds)],
        })),
      ]),
    ),
    openQuestions: [...r.missing.map((m) => `Data not available: ${m}`), ...n.openQuestions]
      .map((q) => q.slice(0, 300))
      .slice(0, 10),
    sources: pack.map((s) => ({
      id: s.id,
      title: s.title,
      url: s.url,
      publisher: s.publisher,
      publishedAt: s.publishedAt,
      retrievedAt: s.retrievedAt,
    })),
    dataFreshness: freshness(
      r.highlights ?? {
        figures: [],
        fiscalYear: null,
        periodEnd: null,
        filed: null,
        accession: null,
        missing: [],
        hasFacts: false,
      },
      generatedAt,
      r.valuation.length > 0,
    ),
    disclaimer: DISCLAIMER,
    generation: {
      model: model.model,
      provider: model.provider,
      promptVersion: PROMPT_VERSION,
      generatedAt: generatedAt.toISOString(),
    },
  } as ResearchBriefV1;
  const v = validateBrief(brief, pack, NARRATIVE_SECTIONS);
  return v.brief ? { brief: v.brief } : { errors: v.errors };
}

export async function generateBrief(
  deps: PipelineDeps,
  entity: ResolvedEntity,
  excerpt: string | null,
) {
  const r = await retrieve(deps, entity);
  const { pack, ids } = buildSourcePack(r);
  if (pack.length === 0)
    throw new ResearchFailure(
      "Not enough public data was available to write a cited brief for this entity.",
      r.missing,
    );
  const schemaJson = narrativeJsonSchema(pack.map((s) => s.id));
  const generatedAt = deps.now();
  const result = await runModels(
    deps,
    "brief",
    (errors) => ({
      system: RESEARCH_SYSTEM,
      user: researchUserPrompt(r.entity, pack, excerpt, errors),
      schema: schemaJson,
      schemaName: "research_brief",
      maxOutputTokens: 4000,
    }),
    (json, model) => {
      const a = assembleBrief(json, r, pack, ids, model, generatedAt);
      return "brief" in a ? { ok: a.brief } : a;
    },
  );
  return { brief: result.value, model: result.model, pack, attempts: result.attempts };
}

// ---- Steps 6–7: the whole request ---------------------------------------------------------
export interface ProcessResult {
  status: "completed" | "failed";
  briefId?: string;
  reason?: string;
  cached?: boolean;
  provider?: string;
  model?: string;
}

function supportsBySource(brief: ResearchBriefV1): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const section of ["financialHighlights", "valuation", ...NARRATIVE_SECTIONS] as const) {
    for (const claim of brief[section])
      for (const sid of claim.sourceIds) m.set(sid, [...(m.get(sid) ?? []), claim.id]);
  }
  return m;
}

async function persistBrief(
  deps: PipelineDeps,
  req: { id: string; userId: string; entityId: string },
  data: {
    brief: ResearchBriefV1;
    pack: PackSource[];
    provider: string;
    model: string;
    publicOnly: boolean;
    cachedFrom: string | null;
    generatedAt: Date;
  },
): Promise<string> {
  const briefId = newId();
  const supports = supportsBySource(data.brief);
  await deps.db.db.transaction(async (tx) => {
    await tx.insert(schema.researchBriefs).values({
      id: briefId,
      userId: req.userId,
      entityId: req.entityId,
      schemaVersion: BRIEF_SCHEMA_VERSION,
      brief: data.brief,
      model: data.model,
      provider: data.provider,
      promptVersion: data.brief.generation.promptVersion,
      dataFreshness: data.brief.dataFreshness,
      sourcePack: data.pack,
      publicOnly: data.publicOnly,
      cachedFrom: data.cachedFrom,
      generatedAt: data.generatedAt,
    });
    if (data.brief.sources.length) {
      await tx.insert(schema.briefSources).values(
        data.brief.sources.map((s) => ({
          id: newId(),
          briefId,
          url: s.url,
          title: s.title,
          publisher: s.publisher,
          publishedAt: s.publishedAt ? new Date(s.publishedAt) : null,
          retrievedAt: new Date(s.retrievedAt),
          supports: supports.get(s.id) ?? [],
        })),
      );
    }
    await tx
      .update(schema.researchRequests)
      .set({ status: "completed", briefId, failureReason: null, updatedAt: deps.now() })
      .where(eq(schema.researchRequests.id, req.id));
  });
  return briefId;
}

async function fail(deps: PipelineDeps, requestId: string, reason: string): Promise<ProcessResult> {
  await deps.db.db
    .update(schema.researchRequests)
    .set({ status: "failed", failureReason: reason.slice(0, 300), updatedAt: deps.now() })
    .where(eq(schema.researchRequests.id, requestId));
  return { status: "failed", reason };
}

/** Runs one research request end to end (PRD §7.5). Idempotent: completed requests are skipped. */
export async function processRequest(
  deps: PipelineDeps,
  requestId: string,
): Promise<ProcessResult> {
  const req = (
    await deps.db.db
      .select()
      .from(schema.researchRequests)
      .where(eq(schema.researchRequests.id, requestId))
  )[0];
  if (!req) return { status: "failed", reason: "Unknown request" };
  if (req.status === "completed") return { status: "completed", briefId: req.briefId ?? undefined };
  await deps.db.db
    .update(schema.researchRequests)
    .set({ status: "processing", updatedAt: deps.now() })
    .where(eq(schema.researchRequests.id, requestId));
  const log = (event: string, f: Record<string, unknown> = {}) =>
    deps.log(event, { requestId, ...f });

  const entity = await resolveEntity(deps.db, { id: req.entityId });
  if (!entity) return fail(deps, requestId, "Unknown entity");
  const publicOnly = !req.excerpt;

  // Cache: a public-data-only brief for the same entity + prompt version within the TTL is copied
  // into this user's own row. Requests with an excerpt are never served from or written to the cache.
  if (publicOnly && deps.cacheTtlMs > 0) {
    const since = new Date(deps.now().getTime() - deps.cacheTtlMs);
    const hit = (
      await deps.db.db
        .select()
        .from(schema.researchBriefs)
        .where(
          and(
            eq(schema.researchBriefs.entityId, entity.id),
            eq(schema.researchBriefs.promptVersion, PROMPT_VERSION),
            eq(schema.researchBriefs.publicOnly, true),
            isNull(schema.researchBriefs.cachedFrom),
            gt(schema.researchBriefs.generatedAt, since),
          ),
        )
        .orderBy(desc(schema.researchBriefs.generatedAt))
        .limit(1)
    )[0];
    if (hit) {
      const briefId = await persistBrief(
        deps,
        { id: req.id, userId: req.userId, entityId: entity.id },
        {
          brief: hit.brief as ResearchBriefV1,
          pack: hit.sourcePack as PackSource[],
          provider: hit.provider,
          model: hit.model,
          publicOnly: true,
          cachedFrom: hit.id,
          generatedAt: hit.generatedAt,
        },
      );
      log("research.cache_hit", { entity: entity.canonicalId });
      return {
        status: "completed",
        briefId,
        cached: true,
        provider: hit.provider,
        model: hit.model,
      };
    }
  }

  const slot = await deps.quota.take(req.userId, deps.dailyLimit, deps.now(), "brief");
  if (!slot) {
    log("research.limit_reached", {});
    return fail(deps, requestId, LIMIT_REACHED(deps.dailyLimit));
  }
  try {
    const g = await generateBrief(deps, entity, req.excerpt);
    const briefId = await persistBrief(
      deps,
      { id: req.id, userId: req.userId, entityId: entity.id },
      {
        brief: g.brief,
        pack: g.pack,
        provider: g.model.provider,
        model: g.model.model,
        publicOnly,
        cachedFrom: null,
        generatedAt: new Date(g.brief.generation.generatedAt),
      },
    );
    log("research.completed", {
      entity: entity.canonicalId,
      provider: g.model.provider,
      model: g.model.model,
      sources: g.pack.length,
      attempts: g.attempts,
    });
    return { status: "completed", briefId, provider: g.model.provider, model: g.model.model };
  } catch (e) {
    // Refund only when no model call returned (e.g. no data, providers down before answering).
    // Validation failures spent tokens and keep the slot, so failing requests cannot bypass the cap.
    if (e instanceof ResearchFailure && !e.tokensSpent) await deps.quota.refund(slot);
    if (e instanceof ResearchFailure) {
      log("research.request_failed", { detail: e.detail });
      return fail(deps, requestId, e.reason);
    }
    log("research.request_error", { error: (e as Error).name });
    return fail(deps, requestId, "Research failed because of an internal error. Please try again.");
  }
}
