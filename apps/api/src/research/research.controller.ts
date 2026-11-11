import { Controller, Inject, Param, Req } from "@nestjs/common";
import { type DbHandle, schema } from "@suiem/db";
import { newId } from "@suiem/shared/ids";
import type { ResearchBriefV1 } from "@suiem/shared/research";
import {
  answerQuestion,
  compareEntities,
  draftThesis,
  FINNHUB_DOCS_URL,
  type PackSource,
  ResearchFailure,
  resolveEntity,
} from "@suiem/research";
import {
  briefListQuery,
  briefListResponse,
  briefResponse,
  compareRequest,
  compareResponse,
  createBriefRequest,
  createBriefResponse,
  entityIdParam,
  feedbackRequest,
  feedbackResponse,
  questionItem,
  questionRequest,
  quoteResponse,
  researchRequestsResponse,
  thesisDraftRequest,
  thesisDraftResponse,
  uuidParam,
} from "@suiem/shared/schemas";
import { and, desc, eq, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { actorUserId } from "../extension/extension.controller";
import { ApiError } from "../http/errors";
import { Route } from "../http/route";
import type { AppLogger } from "../observability/logger";
import { CLOCK, type Clock, DB, LOGGER } from "../tokens";
import { pipelineDeps, RESEARCH, type ResearchRuntime } from "./runtime";

const iso = (d: Date) => d.toISOString();

/** Maps a ResearchFailure to an API error (user-safe message only). */
function failure(e: unknown): never {
  if (e instanceof ResearchFailure)
    throw new ApiError(
      /busy|limits/.test(e.reason) ? "PROVIDER_UNAVAILABLE" : "RESEARCH_FAILED",
      e.reason,
    );
  throw e;
}

@Controller()
export class ResearchController {
  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(RESEARCH) private readonly rt: ResearchRuntime,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(LOGGER) private readonly logger: AppLogger,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private deps() {
    return pipelineDeps(
      this.rt,
      this.db,
      () => this.clock.now(),
      (event, fields) => this.logger.info({ component: "research", ...fields }, event),
    );
  }

  /** Loads a brief the current user owns (briefs are private to their requester). */
  private async ownBrief(userId: string, id: string) {
    if (!uuidParam.safeParse(id).success) throw new ApiError("NOT_FOUND", "Unknown brief");
    const row = (
      await this.db.db
        .select({ b: schema.researchBriefs, canonicalId: schema.entities.canonicalId })
        .from(schema.researchBriefs)
        .innerJoin(schema.entities, eq(schema.entities.id, schema.researchBriefs.entityId))
        .where(and(eq(schema.researchBriefs.id, id), eq(schema.researchBriefs.userId, userId)))
    )[0];
    if (!row) throw new ApiError("NOT_FOUND", "Unknown brief");
    return row;
  }

  private async takeSlot(userId: string, scope: "question" | "draft", limit: number) {
    const slot = await this.rt.quota.take(userId, limit, this.clock.now(), scope);
    if (!slot)
      throw new ApiError(
        "RESEARCH_LIMIT",
        `Daily limit reached (${limit} per day). It resets at 00:00 UTC.`,
      );
    return slot;
  }

  @Route({
    method: "POST",
    path: "/research/briefs",
    summary: "Request an AI research brief for an entity (queued; poll /research/requests)",
    tags: ["research"],
    auth: "user",
    body: createBriefRequest,
    response: createBriefResponse,
    status: 202,
  })
  async create(@Req() req: FastifyRequest) {
    const userId = req.suiem.session!.userId;
    const { entityId } = req.body as z.infer<typeof createBriefRequest>;
    const entity = await resolveEntity(this.db, { canonicalId: entityId });
    if (!entity) throw new ApiError("NOT_FOUND", "Unknown entity");
    const id = newId();
    const row = (
      await this.db.db
        .insert(schema.researchRequests)
        .values({ id, userId, entityId: entity.id, source: "web", sourceUrl: null, excerpt: null })
        .returning()
    )[0]!;
    await this.audit.write({
      actorType: "user",
      actorUserId: userId,
      action: "research.requested",
      outcome: "success",
      targetType: "research_request",
      targetId: id,
      requestId: req.suiem.requestId,
    });
    await this.rt.enqueue(id);
    return {
      id,
      entityId,
      status: row.status,
      source: "web" as const,
      sourceUrl: null,
      hasExcerpt: false,
      createdAt: iso(row.createdAt),
      briefId: null,
      failureReason: null,
    };
  }

  @Route({
    method: "GET",
    path: "/research/requests",
    summary:
      "The user's research requests with status (completed ones include the summary and top risks)",
    tags: ["research"],
    auth: "user_or_device",
    response: researchRequestsResponse,
  })
  async requests(@Req() req: FastifyRequest) {
    const q = req.query as { entityId?: string };
    const filter =
      q.entityId && entityIdParam.safeParse(q.entityId).success
        ? eq(schema.entities.canonicalId, q.entityId)
        : sql`true`;
    const rows = await this.db.db
      .select({
        r: schema.researchRequests,
        entityId: schema.entities.canonicalId,
        brief: schema.researchBriefs.brief,
      })
      .from(schema.researchRequests)
      .innerJoin(schema.entities, eq(schema.entities.id, schema.researchRequests.entityId))
      .leftJoin(
        schema.researchBriefs,
        eq(schema.researchBriefs.id, schema.researchRequests.briefId),
      )
      .where(and(eq(schema.researchRequests.userId, actorUserId(req)), filter))
      .orderBy(desc(schema.researchRequests.createdAt))
      .limit(50);
    return {
      items: rows.map(({ r, entityId, brief }) => {
        const b = brief as ResearchBriefV1 | null;
        return {
          id: r.id,
          entityId,
          status: r.status,
          source: r.source,
          sourceUrl: r.sourceUrl,
          hasExcerpt: r.excerpt !== null,
          createdAt: iso(r.createdAt),
          briefId: r.briefId,
          failureReason: r.failureReason,
          summary: b?.summary ?? null,
          topRisks: (b?.risks ?? []).slice(0, 3).map((c) => c.text),
        };
      }),
    };
  }

  @Route({
    method: "GET",
    path: "/research/briefs",
    summary: "The user's recent briefs",
    tags: ["research"],
    auth: "user",
    query: briefListQuery,
    response: briefListResponse,
  })
  async list(@Req() req: FastifyRequest) {
    const q = req.query as z.infer<typeof briefListQuery>;
    const rows = await this.db.db
      .select({
        b: schema.researchBriefs,
        canonicalId: schema.entities.canonicalId,
        name: schema.entities.name,
      })
      .from(schema.researchBriefs)
      .innerJoin(schema.entities, eq(schema.entities.id, schema.researchBriefs.entityId))
      .where(
        and(
          eq(schema.researchBriefs.userId, req.suiem.session!.userId),
          q.entityId ? eq(schema.entities.canonicalId, q.entityId) : sql`true`,
        ),
      )
      .orderBy(desc(schema.researchBriefs.createdAt))
      .limit(q.limit ?? 20);
    return {
      items: rows.map(({ b, canonicalId, name }) => ({
        id: b.id,
        entityId: canonicalId,
        entityName: name,
        summary: (b.brief as ResearchBriefV1).summary,
        model: b.model,
        provider: b.provider,
        dataFreshness: b.dataFreshness,
        generatedAt: iso(b.generatedAt),
        cached: b.cachedFrom !== null,
      })),
    };
  }

  @Route({
    method: "GET",
    path: "/research/briefs/:id",
    summary: "A brief (owner only), with follow-up questions and the user's feedback",
    tags: ["research"],
    auth: "user",
    response: briefResponse,
  })
  async get(@Req() req: FastifyRequest, @Param("id") id: string) {
    const userId = req.suiem.session!.userId;
    const { b, canonicalId } = await this.ownBrief(userId, id);
    const questions = await this.db.db
      .select()
      .from(schema.researchQuestions)
      .where(eq(schema.researchQuestions.briefId, b.id))
      .orderBy(schema.researchQuestions.createdAt);
    const feedback = await this.db.db
      .select()
      .from(schema.briefFeedback)
      .where(and(eq(schema.briefFeedback.briefId, b.id), eq(schema.briefFeedback.userId, userId)))
      .orderBy(schema.briefFeedback.createdAt);
    return {
      id: b.id,
      entityId: canonicalId,
      brief: b.brief as Record<string, unknown>,
      model: b.model,
      provider: b.provider,
      promptVersion: b.promptVersion,
      schemaVersion: b.schemaVersion,
      dataFreshness: b.dataFreshness,
      generatedAt: iso(b.generatedAt),
      cached: b.cachedFrom !== null,
      questions: questions.map((q) => this.questionView(q)),
      myFeedback: feedback.map((f) => ({
        kind: f.kind,
        note: f.note,
        createdAt: iso(f.createdAt),
      })),
    };
  }

  private questionView(
    q: typeof schema.researchQuestions.$inferSelect,
  ): z.infer<typeof questionItem> {
    const a = q.answer as {
      insufficientSources: boolean;
      claims: z.infer<typeof questionItem>["claims"];
      provider: string;
    };
    return {
      id: q.id,
      question: q.question,
      insufficientSources: a.insufficientSources,
      claims: a.claims,
      model: q.model,
      provider: a.provider,
      createdAt: iso(q.createdAt),
    };
  }

  @Route({
    method: "POST",
    path: "/research/briefs/:id/questions",
    summary: "Ask a follow-up question, answered only from this brief's sources (cited)",
    tags: ["research"],
    auth: "user",
    body: questionRequest,
    response: questionItem,
    status: 201,
  })
  async ask(@Req() req: FastifyRequest, @Param("id") id: string) {
    const userId = req.suiem.session!.userId;
    const { b } = await this.ownBrief(userId, id);
    const { question } = req.body as z.infer<typeof questionRequest>;
    const pack = b.sourcePack as PackSource[];
    if (pack.length === 0)
      throw new ApiError("RESEARCH_FAILED", "This brief has no stored sources to answer from.");
    const slot = await this.takeSlot(userId, "question", this.rt.dailyLimit * 3);
    let answer;
    try {
      answer = await answerQuestion(this.deps(), pack, question);
    } catch (e) {
      if (e instanceof ResearchFailure && !e.tokensSpent) await this.rt.quota.refund(slot);
      failure(e);
    }
    const row = (
      await this.db.db
        .insert(schema.researchQuestions)
        .values({
          id: newId(),
          briefId: b.id,
          userId,
          question,
          model: answer.model,
          answer: {
            insufficientSources: answer.insufficientSources,
            claims: answer.claims,
            provider: answer.provider,
            promptVersion: answer.promptVersion,
          },
        })
        .returning()
    )[0]!;
    return this.questionView(row);
  }

  @Route({
    method: "POST",
    path: "/research/briefs/:id/feedback",
    summary: "Mark a brief helpful, incorrect or outdated (with an optional note)",
    tags: ["research"],
    auth: "user",
    body: feedbackRequest,
    response: feedbackResponse,
    status: 201,
  })
  async feedback(@Req() req: FastifyRequest, @Param("id") id: string) {
    const userId = req.suiem.session!.userId;
    const { b } = await this.ownBrief(userId, id);
    const body = req.body as z.infer<typeof feedbackRequest>;
    const row = (
      await this.db.db
        .insert(schema.briefFeedback)
        .values({ id: newId(), briefId: b.id, userId, kind: body.kind, note: body.note ?? null })
        .returning()
    )[0]!;
    return { id: row.id, kind: row.kind, createdAt: iso(row.createdAt) };
  }

  @Route({
    method: "POST",
    path: "/research/compare",
    summary: "Compare 2–3 entities: a deterministic table from EDGAR + Finnhub figures (no AI)",
    tags: ["research"],
    auth: "user",
    body: compareRequest,
    response: compareResponse,
  })
  async compare(@Req() req: FastifyRequest) {
    const { entityIds } = req.body as z.infer<typeof compareRequest>;
    if (new Set(entityIds).size !== entityIds.length)
      throw new ApiError("VALIDATION_FAILED", "Pick different companies");
    const entities = [];
    for (const id of entityIds) {
      const e = await resolveEntity(this.db, { canonicalId: id });
      if (!e) throw new ApiError("NOT_FOUND", `Unknown entity ${id}`);
      entities.push(e);
    }
    return compareEntities(this.deps(), entities);
  }

  @Route({
    method: "POST",
    path: "/research/theses/draft",
    summary: "AI drafting help for a thesis from a brief. Returns a draft to edit; never saved",
    tags: ["research", "theses"],
    auth: "user",
    body: thesisDraftRequest,
    response: thesisDraftResponse,
  })
  async draft(@Req() req: FastifyRequest) {
    const userId = req.suiem.session!.userId;
    const body = req.body as z.infer<typeof thesisDraftRequest>;
    const { b } = await this.ownBrief(userId, body.briefId);
    const slot = await this.takeSlot(userId, "draft", this.rt.dailyLimit);
    try {
      const d = await draftThesis(this.deps(), b.id, b.brief as ResearchBriefV1, body.direction);
      return { ...d, saved: false as const };
    } catch (e) {
      if (e instanceof ResearchFailure && !e.tokensSpent) await this.rt.quota.refund(slot);
      failure(e);
    }
  }

  @Route({
    method: "GET",
    path: "/entities/:id/quote",
    summary: "Latest quote with timestamp and source (Finnhub free tier)",
    tags: ["entities"],
    auth: "user",
    response: quoteResponse,
  })
  async quote(@Param("id") id: string) {
    if (!entityIdParam.safeParse(id).success) throw new ApiError("NOT_FOUND", "Unknown entity");
    const e = await resolveEntity(this.db, { canonicalId: id });
    if (!e) throw new ApiError("NOT_FOUND", "Unknown entity");
    return quoteFor(this.rt, e.ticker);
  }
}

/** Quote → decimal strings with timestamp and source. Throws NOT_FOUND / PROVIDER_UNAVAILABLE. */
export async function quoteFor(
  rt: ResearchRuntime,
  ticker: string | null,
): Promise<z.infer<typeof quoteResponse>> {
  if (!ticker) throw new ApiError("NOT_FOUND", "No listed ticker for this entity");
  if (!rt.market) throw new ApiError("PROVIDER_UNAVAILABLE", "Market data is not configured");
  let q;
  try {
    q = await rt.market.quote(ticker);
  } catch {
    throw new ApiError("PROVIDER_UNAVAILABLE", "Market data is unavailable right now");
  }
  if (!q.data.t || !Number.isFinite(q.data.c) || q.data.c <= 0)
    throw new ApiError("NOT_FOUND", "No quote available");
  const s = (n: number | null | undefined) =>
    typeof n === "number" && Number.isFinite(n) ? String(n) : null;
  return {
    symbol: ticker,
    currency: "USD",
    price: String(q.data.c),
    change: s(q.data.d),
    changePercent: s(q.data.dp),
    previousClose: s(q.data.pc),
    asOf: new Date(q.data.t * 1000).toISOString(),
    retrievedAt: q.retrievedAt.toISOString(),
    source: "Finnhub (free tier)",
    sourceUrl: FINNHUB_DOCS_URL.replace("company-basic-financials", "quote"),
  };
}
