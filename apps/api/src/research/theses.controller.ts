import { Controller, Inject, Param, Req } from "@nestjs/common";
import { type DbHandle, schema } from "@suiem/db";
import { newId } from "@suiem/shared/ids";
import { BRIEF_CLAIM_SECTIONS, type ResearchBriefV1 } from "@suiem/shared/research";
import { resolveEntity } from "@suiem/research";
import type { thesisContent } from "@suiem/shared/schemas";
import {
  createThesisRequest,
  publishThesisRequest,
  reviewThesisRequest,
  thesisListResponse,
  thesisResponse,
  updateThesisRequest,
  uuidParam,
} from "@suiem/shared/schemas";
import { and, asc, desc, eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { ApiError } from "../http/errors";
import { Route } from "../http/route";
import { CLOCK, type Clock, DB } from "../tokens";
import { quoteFor } from "./research.controller";
import { RESEARCH, type ResearchRuntime } from "./runtime";

type Content = z.infer<typeof thesisContent>;

/**
 * Theses (PRD §5.4): every edit appends a frozen version (the DB forbids UPDATE/DELETE on
 * thesis_versions); private by default; publish is explicit; reviews never touch versions.
 */
@Controller()
export class ThesesController {
  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(RESEARCH) private readonly rt: ResearchRuntime,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  /** Evidence must point at claims in the user's OWN briefs; text is copied from the brief. */
  private async resolveEvidence(userId: string, refs: Content["evidence"]) {
    const out: { briefId: string; claimId: string; text: string }[] = [];
    for (const ref of refs) {
      const b = (
        await this.db.db
          .select({ brief: schema.researchBriefs.brief })
          .from(schema.researchBriefs)
          .where(
            and(
              eq(schema.researchBriefs.id, ref.briefId),
              eq(schema.researchBriefs.userId, userId),
            ),
          )
      )[0];
      const brief = b?.brief as ResearchBriefV1 | undefined;
      const claim =
        brief && BRIEF_CLAIM_SECTIONS.flatMap((s) => brief[s]).find((c) => c.id === ref.claimId);
      if (!claim)
        throw new ApiError(
          "VALIDATION_FAILED",
          `Evidence ${ref.briefId}/${ref.claimId} is not a claim in one of your briefs`,
        );
      out.push({ briefId: ref.briefId, claimId: ref.claimId, text: claim.text });
    }
    return out;
  }

  /** Price context at the moment of writing (timestamp + source). Null when unavailable. */
  private async priceContext(ticker: string | null) {
    try {
      const q = await quoteFor(this.rt, ticker);
      return {
        symbol: q.symbol,
        price: q.price,
        currency: q.currency,
        asOf: q.asOf,
        retrievedAt: q.retrievedAt,
        source: q.source,
        sourceUrl: q.sourceUrl,
      };
    } catch {
      return null;
    }
  }

  private async load(id: string) {
    if (!uuidParam.safeParse(id).success) throw new ApiError("NOT_FOUND", "Unknown thesis");
    const row = (
      await this.db.db
        .select({
          t: schema.theses,
          canonicalId: schema.entities.canonicalId,
          name: schema.entities.name,
          ticker: schema.entities.id,
          handle: schema.users.handle,
        })
        .from(schema.theses)
        .innerJoin(schema.entities, eq(schema.entities.id, schema.theses.entityId))
        .innerJoin(schema.users, eq(schema.users.id, schema.theses.userId))
        .where(eq(schema.theses.id, id))
    )[0];
    if (!row) throw new ApiError("NOT_FOUND", "Unknown thesis");
    return row;
  }

  private async own(userId: string, id: string) {
    const row = await this.load(id);
    if (row.t.userId !== userId) throw new ApiError("NOT_FOUND", "Unknown thesis");
    return row;
  }

  private async canView(viewerId: string, t: typeof schema.theses.$inferSelect): Promise<boolean> {
    if (t.userId === viewerId || t.visibility === "public") return true;
    if (t.visibility !== "followers") return false;
    const f = await this.db.db
      .select()
      .from(schema.follows)
      .where(and(eq(schema.follows.followerId, viewerId), eq(schema.follows.followeeId, t.userId)));
    return f.length > 0;
  }

  private async view(
    viewerId: string,
    row: Awaited<ReturnType<ThesesController["load"]>>,
  ): Promise<z.infer<typeof thesisResponse>> {
    const versions = await this.db.db
      .select()
      .from(schema.thesisVersions)
      .where(eq(schema.thesisVersions.thesisId, row.t.id))
      .orderBy(asc(schema.thesisVersions.version));
    const reviews = await this.db.db
      .select()
      .from(schema.thesisReviews)
      .where(eq(schema.thesisReviews.thesisId, row.t.id))
      .orderBy(asc(schema.thesisReviews.createdAt));
    const isMe = row.t.userId === viewerId;
    return {
      id: row.t.id,
      entityId: row.canonicalId,
      entityName: row.name,
      owner: { handle: row.handle, isMe },
      visibility: row.t.visibility,
      status: row.t.status,
      currentVersion: row.t.currentVersion,
      createdAt: row.t.createdAt.toISOString(),
      updatedAt: row.t.updatedAt.toISOString(),
      publishedAt: row.t.publishedAt?.toISOString() ?? null,
      // Non-owners see only the current version; owners see the full read-only history.
      versions: versions
        .filter((v) => isMe || v.version === row.t.currentVersion)
        .map((v) => ({
          version: v.version,
          direction: v.direction,
          horizonDays: v.horizonDays,
          title: v.title,
          rationale: v.rationale,
          evidence: v.evidence as { briefId: string; claimId: string; text: string }[],
          counterarguments: v.counterarguments,
          risks: v.risks,
          invalidation: v.invalidation,
          priceContext:
            (v.priceContext as z.infer<
              typeof thesisResponse
            >["versions"][number]["priceContext"]) ?? null,
          createdAt: v.createdAt.toISOString(),
        })),
      reviews: reviews.map((r) => ({
        id: r.id,
        outcome: r.outcome,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }

  private async appendVersion(
    tx: Parameters<Parameters<DbHandle["db"]["transaction"]>[0]>[0],
    thesisId: string,
    version: number,
    c: Content,
    evidence: unknown,
    priceContext: unknown,
  ) {
    await tx.insert(schema.thesisVersions).values({
      id: newId(),
      thesisId,
      version,
      direction: c.direction,
      horizonDays: c.horizonDays,
      title: c.title,
      rationale: c.rationale,
      evidence,
      counterarguments: c.counterarguments,
      risks: c.risks,
      invalidation: c.invalidation,
      priceContext,
    });
  }

  @Route({
    method: "GET",
    path: "/theses",
    summary: "The user's theses",
    tags: ["theses"],
    auth: "user",
    response: thesisListResponse,
  })
  async list(@Req() req: FastifyRequest) {
    const rows = await this.db.db
      .select({
        t: schema.theses,
        v: schema.thesisVersions,
        canonicalId: schema.entities.canonicalId,
        name: schema.entities.name,
      })
      .from(schema.theses)
      .innerJoin(
        schema.thesisVersions,
        and(
          eq(schema.thesisVersions.thesisId, schema.theses.id),
          eq(schema.thesisVersions.version, schema.theses.currentVersion),
        ),
      )
      .innerJoin(schema.entities, eq(schema.entities.id, schema.theses.entityId))
      .where(eq(schema.theses.userId, req.suiem.session!.userId))
      .orderBy(desc(schema.theses.updatedAt))
      .limit(100);
    return {
      items: rows.map(({ t, v, canonicalId, name }) => ({
        id: t.id,
        entityId: canonicalId,
        entityName: name,
        title: v.title,
        direction: v.direction,
        visibility: t.visibility,
        status: t.status,
        currentVersion: t.currentVersion,
        updatedAt: t.updatedAt.toISOString(),
      })),
    };
  }

  @Route({
    method: "POST",
    path: "/theses",
    summary: "Create a thesis (private draft, version 1, with price context)",
    tags: ["theses"],
    auth: "user",
    body: createThesisRequest,
    response: thesisResponse,
    status: 201,
  })
  async create(@Req() req: FastifyRequest) {
    const userId = req.suiem.session!.userId;
    const body = req.body as z.infer<typeof createThesisRequest>;
    const entity = await resolveEntity(this.db, { canonicalId: body.entityId });
    if (!entity) throw new ApiError("NOT_FOUND", "Unknown entity");
    const evidence = await this.resolveEvidence(userId, body.evidence);
    const priceContext = await this.priceContext(entity.ticker);
    const id = newId();
    await this.db.db.transaction(async (tx) => {
      await tx.insert(schema.theses).values({ id, userId, entityId: entity.id, currentVersion: 1 });
      await this.appendVersion(tx, id, 1, body, evidence, priceContext);
    });
    await this.audit.write({
      actorType: "user",
      actorUserId: userId,
      action: "thesis.created",
      outcome: "success",
      targetType: "thesis",
      targetId: id,
      requestId: req.suiem.requestId,
    });
    return this.view(userId, await this.load(id));
  }

  @Route({
    method: "GET",
    path: "/theses/:id",
    summary: "A thesis (owner, or per its visibility)",
    tags: ["theses"],
    auth: "user",
    response: thesisResponse,
  })
  async get(@Req() req: FastifyRequest, @Param("id") id: string) {
    const userId = req.suiem.session!.userId;
    const row = await this.load(id);
    if (!(await this.canView(userId, row.t))) throw new ApiError("NOT_FOUND", "Unknown thesis");
    return this.view(userId, row);
  }

  @Route({
    method: "PATCH",
    path: "/theses/:id",
    summary: "Edit = append a new frozen version (old versions never change)",
    tags: ["theses"],
    auth: "user",
    body: updateThesisRequest,
    response: thesisResponse,
  })
  async update(@Req() req: FastifyRequest, @Param("id") id: string) {
    const userId = req.suiem.session!.userId;
    const row = await this.own(userId, id);
    if (row.t.status === "closed")
      throw new ApiError("CONFLICT", "A closed thesis can't be edited");
    const body = req.body as Content;
    const evidence = await this.resolveEvidence(userId, body.evidence);
    const entity = await resolveEntity(this.db, { id: row.t.entityId });
    const priceContext = await this.priceContext(entity?.ticker ?? null);
    const next = row.t.currentVersion + 1;
    await this.db.db.transaction(async (tx) => {
      await this.appendVersion(tx, id, next, body, evidence, priceContext);
      await tx.update(schema.theses).set({ currentVersion: next }).where(eq(schema.theses.id, id));
    });
    return this.view(userId, await this.load(id));
  }

  @Route({
    method: "POST",
    path: "/theses/:id/publish",
    summary: "Set visibility (private / followers / public). Nothing is public by default",
    tags: ["theses"],
    auth: "user",
    body: publishThesisRequest,
    response: thesisResponse,
  })
  async publish(@Req() req: FastifyRequest, @Param("id") id: string) {
    const userId = req.suiem.session!.userId;
    const row = await this.own(userId, id);
    const { visibility } = req.body as z.infer<typeof publishThesisRequest>;
    const published = visibility !== "private";
    await this.db.db
      .update(schema.theses)
      .set({
        visibility,
        status: row.t.status === "closed" ? "closed" : published ? "published" : "draft",
        publishedAt: published ? (row.t.publishedAt ?? this.clock.now()) : row.t.publishedAt,
      })
      .where(eq(schema.theses.id, id));
    await this.audit.write({
      actorType: "user",
      actorUserId: userId,
      action: "thesis.visibility_changed",
      outcome: "success",
      targetType: "thesis",
      targetId: id,
      requestId: req.suiem.requestId,
    });
    return this.view(userId, await this.load(id));
  }

  @Route({
    method: "POST",
    path: "/theses/:id/review",
    summary: "Add an outcome review (versions stay frozen)",
    tags: ["theses"],
    auth: "user",
    body: reviewThesisRequest,
    response: thesisResponse,
    status: 201,
  })
  async review(@Req() req: FastifyRequest, @Param("id") id: string) {
    const userId = req.suiem.session!.userId;
    await this.own(userId, id);
    const body = req.body as z.infer<typeof reviewThesisRequest>;
    await this.db.db
      .insert(schema.thesisReviews)
      .values({ id: newId(), thesisId: id, userId, outcome: body.outcome, note: body.note });
    return this.view(userId, await this.load(id));
  }
}
