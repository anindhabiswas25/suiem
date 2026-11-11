import { Controller, Inject, Param, Req } from "@nestjs/common";
import { type DbHandle, schema } from "@suiem/db";
import { CIK_MAP } from "@suiem/shared/entities";
import { newId } from "@suiem/shared/ids";
import {
  uuidParam,
  watchlistCreateRequest,
  watchlistFull,
  watchlistItemAddRequest,
  watchlistItemMutationResponse,
  watchlistItemPatchRequest,
  watchlistsResponse,
} from "@suiem/shared/schemas";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import type { z } from "zod";
import { ApiError } from "../http/errors";
import { Route } from "../http/route";
import { DB } from "../tokens";

/** Multiple watchlists with notes and thesis links (PRD §8.5). Session only: no device token. */
@Controller()
export class WatchlistsController {
  constructor(@Inject(DB) private readonly db: DbHandle) {}

  private async own(userId: string, id: string) {
    if (!uuidParam.safeParse(id).success) throw new ApiError("NOT_FOUND", "Unknown watchlist");
    const w = (
      await this.db.db
        .select()
        .from(schema.watchlists)
        .where(and(eq(schema.watchlists.id, id), eq(schema.watchlists.userId, userId)))
    )[0];
    if (!w) throw new ApiError("NOT_FOUND", "Unknown watchlist");
    return w;
  }

  private async items(watchlistIds: string[]) {
    if (watchlistIds.length === 0) return [];
    const rows = await this.db.db
      .select({
        i: schema.watchlistItems,
        canonicalId: schema.entities.canonicalId,
        name: schema.entities.name,
      })
      .from(schema.watchlistItems)
      .innerJoin(schema.entities, eq(schema.entities.id, schema.watchlistItems.entityId))
      .where(inArray(schema.watchlistItems.watchlistId, watchlistIds))
      .orderBy(desc(schema.watchlistItems.addedAt));
    return rows.map(({ i, canonicalId, name }) => ({
      watchlistId: i.watchlistId,
      item: {
        id: i.id,
        entityId: canonicalId,
        name,
        note: i.note,
        addedAt: i.addedAt.toISOString(),
        thesisId: i.thesisId,
        ticker: CIK_MAP[canonicalId]?.ticker ?? null,
      },
    }));
  }

  private async view(
    w: typeof schema.watchlists.$inferSelect,
  ): Promise<z.infer<typeof watchlistFull>> {
    return {
      id: w.id,
      name: w.name,
      createdAt: w.createdAt.toISOString(),
      items: (await this.items([w.id])).map((x) => x.item),
    };
  }

  @Route({
    method: "GET",
    path: "/watchlists",
    summary: "All of the user's watchlists with items",
    tags: ["watchlists"],
    auth: "user",
    response: watchlistsResponse,
  })
  async list(@Req() req: FastifyRequest) {
    const lists = await this.db.db
      .select()
      .from(schema.watchlists)
      .where(eq(schema.watchlists.userId, req.suiem.session!.userId))
      .orderBy(asc(schema.watchlists.createdAt));
    const items = await this.items(lists.map((l) => l.id));
    return {
      items: lists.map((w) => ({
        id: w.id,
        name: w.name,
        createdAt: w.createdAt.toISOString(),
        items: items.filter((x) => x.watchlistId === w.id).map((x) => x.item),
      })),
    };
  }

  @Route({
    method: "POST",
    path: "/watchlists",
    summary: "Create a watchlist",
    tags: ["watchlists"],
    auth: "user",
    body: watchlistCreateRequest,
    response: watchlistFull,
    status: 201,
  })
  async create(@Req() req: FastifyRequest) {
    const { name } = req.body as z.infer<typeof watchlistCreateRequest>;
    const userId = req.suiem.session!.userId;
    const row = (
      await this.db.db
        .insert(schema.watchlists)
        .values({ id: newId(), userId, name })
        .onConflictDoNothing()
        .returning()
    )[0];
    if (!row) throw new ApiError("CONFLICT", "You already have a watchlist with that name");
    return this.view(row);
  }

  @Route({
    method: "POST",
    path: "/watchlists/:id/items",
    summary: "Add an entity (idempotent per entity)",
    tags: ["watchlists"],
    auth: "user",
    body: watchlistItemAddRequest,
    response: watchlistItemMutationResponse,
    status: 201,
  })
  async add(@Req() req: FastifyRequest, @Param("id") id: string) {
    const w = await this.own(req.suiem.session!.userId, id);
    const body = req.body as z.infer<typeof watchlistItemAddRequest>;
    const e = (
      await this.db.db
        .select({ id: schema.entities.id })
        .from(schema.entities)
        .where(eq(schema.entities.canonicalId, body.entityId))
    )[0];
    if (!e) throw new ApiError("NOT_FOUND", "Unknown entity");
    const inserted = await this.db.db
      .insert(schema.watchlistItems)
      .values({ id: newId(), watchlistId: w.id, entityId: e.id, note: body.note ?? null })
      .onConflictDoNothing()
      .returning({ id: schema.watchlistItems.id });
    const item = (await this.items([w.id])).find((x) => x.item.entityId === body.entityId)!.item;
    return { item, created: inserted.length > 0 };
  }

  @Route({
    method: "PATCH",
    path: "/watchlists/:id/items/:itemId",
    summary: "Edit an item's note or thesis link",
    tags: ["watchlists"],
    auth: "user",
    body: watchlistItemPatchRequest,
    response: watchlistItemMutationResponse,
  })
  async patch(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Param("itemId") itemId: string,
  ) {
    const userId = req.suiem.session!.userId;
    const w = await this.own(userId, id);
    if (!uuidParam.safeParse(itemId).success) throw new ApiError("NOT_FOUND", "Unknown item");
    const body = req.body as z.infer<typeof watchlistItemPatchRequest>;
    if (body.thesisId) {
      const t = (
        await this.db.db
          .select({ id: schema.theses.id })
          .from(schema.theses)
          .where(and(eq(schema.theses.id, body.thesisId), eq(schema.theses.userId, userId)))
      )[0];
      if (!t) throw new ApiError("NOT_FOUND", "Unknown thesis");
    }
    const set: Partial<typeof schema.watchlistItems.$inferInsert> = {};
    if (body.note !== undefined) set.note = body.note || null;
    if (body.thesisId !== undefined) set.thesisId = body.thesisId;
    const r = await this.db.db
      .update(schema.watchlistItems)
      .set(set)
      .where(and(eq(schema.watchlistItems.id, itemId), eq(schema.watchlistItems.watchlistId, w.id)))
      .returning({ id: schema.watchlistItems.id });
    if (r.length === 0) throw new ApiError("NOT_FOUND", "Unknown item");
    return {
      item: (await this.items([w.id])).find((x) => x.item.id === itemId)!.item,
      created: false,
    };
  }

  @Route({
    method: "DELETE",
    path: "/watchlists/:id/items/:itemId",
    summary: "Remove an item",
    tags: ["watchlists"],
    auth: "user",
    status: 204,
  })
  async remove(
    @Req() req: FastifyRequest,
    @Param("id") id: string,
    @Param("itemId") itemId: string,
  ) {
    const w = await this.own(req.suiem.session!.userId, id);
    if (!uuidParam.safeParse(itemId).success) throw new ApiError("NOT_FOUND", "Unknown item");
    const r = await this.db.db
      .delete(schema.watchlistItems)
      .where(and(eq(schema.watchlistItems.id, itemId), eq(schema.watchlistItems.watchlistId, w.id)))
      .returning({ id: schema.watchlistItems.id });
    if (r.length === 0) throw new ApiError("NOT_FOUND", "Unknown item");
  }
}
