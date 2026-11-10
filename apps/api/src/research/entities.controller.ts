import { Controller, Inject, Param, Req } from "@nestjs/common";
import { type DbHandle, schema } from "@suiem/db";
import { newId } from "@suiem/shared/ids";
import {
  entityIdParam,
  entitySearchQuery,
  entitySearchResponse,
  entitySummary,
  instrumentsResponse,
  researchRequestsResponse,
  watchlistAddRequest,
  watchlistAddResponse,
  watchlistResponse,
} from "@suiem/shared/schemas";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { getAddress } from "viem";
import type { z } from "zod";
import { actorUserId } from "../extension/extension.controller";
import { ApiError } from "../http/errors";
import { Route } from "../http/route";
import { DB } from "../tokens";

const DEFAULT_WATCHLIST = "Default";

const LABEL: Record<string, string> = {
  testnet_test_token: "Testnet · no value",
  demo_token: "Testnet demo · no value",
  simulated: "Simulated",
  unsupported: "Unsupported",
};

@Controller()
export class EntitiesController {
  constructor(@Inject(DB) private readonly db: DbHandle) {}

  private async entityRow(canonicalId: string) {
    if (!entityIdParam.safeParse(canonicalId).success)
      throw new ApiError("NOT_FOUND", "Unknown entity");
    const e = (
      await this.db.db
        .select()
        .from(schema.entities)
        .where(eq(schema.entities.canonicalId, canonicalId))
    )[0];
    if (!e) throw new ApiError("NOT_FOUND", "Unknown entity");
    return e;
  }

  private async summary(
    e: typeof schema.entities.$inferSelect,
  ): Promise<z.infer<typeof entitySummary>> {
    const tickers = await this.db.db
      .select({ alias: schema.entityAliases.alias })
      .from(schema.entityAliases)
      .where(
        and(eq(schema.entityAliases.entityId, e.id), eq(schema.entityAliases.aliasType, "ticker")),
      );
    return {
      canonicalId: e.canonicalId,
      name: e.name,
      legalName: e.legalName,
      kind: e.kind,
      sector: e.sector,
      tickers: tickers.map((t) => t.alias),
    };
  }

  @Route({
    method: "GET",
    path: "/entities/search",
    summary: "Search the entity registry by name or ticker",
    tags: ["entities"],
    auth: "user_or_device",
    query: entitySearchQuery,
    response: entitySearchResponse,
  })
  async search(@Req() req: FastifyRequest) {
    const { q } = req.query as { q: string };
    const pattern = `%${q.replace(/[%_\\]/g, "\\$&")}%`;
    const rows = await this.db.db
      .selectDistinct({ id: schema.entities.id })
      .from(schema.entities)
      .leftJoin(schema.entityAliases, eq(schema.entityAliases.entityId, schema.entities.id))
      .where(or(ilike(schema.entities.name, pattern), ilike(schema.entityAliases.alias, pattern)))
      .limit(10);
    const items = [];
    for (const r of rows) {
      const e = (
        await this.db.db.select().from(schema.entities).where(eq(schema.entities.id, r.id))
      )[0]!;
      items.push(await this.summary(e));
    }
    return { items };
  }

  @Route({
    method: "GET",
    path: "/entities/:id",
    summary: "Entity by canonical id (e.g. ent:nvidia)",
    tags: ["entities"],
    auth: "user_or_device",
    response: entitySummary,
  })
  async get(@Param("id") id: string) {
    return this.summary(await this.entityRow(id));
  }

  @Route({
    method: "GET",
    path: "/entities/:id/instruments",
    summary: "Registry instruments for an entity, with network and labels (no buy action)",
    tags: ["entities"],
    auth: "user_or_device",
    response: instrumentsResponse,
  })
  async instruments(@Param("id") id: string) {
    const e = await this.entityRow(id);
    const rows = await this.db.db
      .select()
      .from(schema.instruments)
      .where(eq(schema.instruments.entityId, e.id));
    return {
      items: rows.map((r) => ({
        id: r.id,
        symbol: r.symbol,
        displayName: r.displayName,
        network: r.network,
        chainId: r.chainId,
        legalType: r.legalType,
        status: r.status,
        label: `${LABEL[r.legalType] ?? r.legalType}${r.status === "unverified" ? " · address unverified" : ""}`,
        contractAddress: r.contractAddress
          ? getAddress(`0x${r.contractAddress.toString("hex")}`)
          : null,
      })),
    };
  }

  private async defaultWatchlistId(userId: string, create: boolean): Promise<string | null> {
    const existing = (
      await this.db.db
        .select({ id: schema.watchlists.id })
        .from(schema.watchlists)
        .where(
          and(eq(schema.watchlists.userId, userId), eq(schema.watchlists.name, DEFAULT_WATCHLIST)),
        )
    )[0];
    if (existing || !create) return existing?.id ?? null;
    await this.db.db
      .insert(schema.watchlists)
      .values({ id: newId(), userId, name: DEFAULT_WATCHLIST })
      .onConflictDoNothing();
    return (
      await this.db.db
        .select({ id: schema.watchlists.id })
        .from(schema.watchlists)
        .where(
          and(eq(schema.watchlists.userId, userId), eq(schema.watchlists.name, DEFAULT_WATCHLIST)),
        )
    )[0]!.id;
  }

  private async items(watchlistId: string) {
    const rows = await this.db.db
      .select({
        id: schema.watchlistItems.id,
        entityId: schema.entities.canonicalId,
        name: schema.entities.name,
        note: schema.watchlistItems.note,
        addedAt: schema.watchlistItems.addedAt,
      })
      .from(schema.watchlistItems)
      .innerJoin(schema.entities, eq(schema.entities.id, schema.watchlistItems.entityId))
      .where(eq(schema.watchlistItems.watchlistId, watchlistId))
      .orderBy(desc(schema.watchlistItems.addedAt));
    return rows.map((r) => ({ ...r, addedAt: r.addedAt.toISOString() }));
  }

  @Route({
    method: "GET",
    path: "/watchlists/default",
    summary: "The user's default watchlist",
    tags: ["watchlists"],
    auth: "user_or_device",
    response: watchlistResponse,
  })
  async watchlist(@Req() req: FastifyRequest) {
    const id = await this.defaultWatchlistId(actorUserId(req), false);
    return { id, name: DEFAULT_WATCHLIST, items: id ? await this.items(id) : [] };
  }

  @Route({
    method: "POST",
    path: "/watchlists/default/items",
    summary: "Add an entity to the default watchlist (idempotent per entity)",
    tags: ["watchlists"],
    auth: "user_or_device",
    body: watchlistAddRequest,
    response: watchlistAddResponse,
  })
  async add(@Req() req: FastifyRequest) {
    const body = req.body as z.infer<typeof watchlistAddRequest>;
    const entity = await this.entityRow(body.entityId);
    const watchlistId = (await this.defaultWatchlistId(actorUserId(req), true))!;
    const inserted = await this.db.db
      .insert(schema.watchlistItems)
      .values({ id: newId(), watchlistId, entityId: entity.id, note: body.note ?? null })
      .onConflictDoNothing()
      .returning({ id: schema.watchlistItems.id });
    const item = (await this.items(watchlistId)).find((i) => i.entityId === body.entityId)!;
    return { item, created: inserted.length === 1 };
  }

  @Route({
    method: "GET",
    path: "/research/requests",
    summary: "The user's queued research requests (briefs arrive in Sprint 4)",
    tags: ["research"],
    auth: "user",
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
        id: schema.researchRequests.id,
        entityId: schema.entities.canonicalId,
        status: schema.researchRequests.status,
        sourceUrl: schema.researchRequests.sourceUrl,
        excerpt: schema.researchRequests.excerpt,
        createdAt: schema.researchRequests.createdAt,
      })
      .from(schema.researchRequests)
      .innerJoin(schema.entities, eq(schema.entities.id, schema.researchRequests.entityId))
      .where(and(eq(schema.researchRequests.userId, req.suiem.session!.userId), filter))
      .orderBy(desc(schema.researchRequests.createdAt))
      .limit(50);
    return {
      items: rows.map((r) => ({
        id: r.id,
        entityId: r.entityId,
        status: r.status,
        sourceUrl: r.sourceUrl,
        hasExcerpt: r.excerpt !== null,
        createdAt: r.createdAt.toISOString(),
      })),
    };
  }
}
