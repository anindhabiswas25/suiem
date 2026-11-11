import { Controller, Inject, Param, Req } from "@nestjs/common";
import type { ApiEnv } from "@suiem/config/env";
import { type DbHandle, schema } from "@suiem/db";
import { DICTIONARY_VERSION, NOTIFY_THRESHOLD } from "@suiem/shared/entities";
import { researchContextRequest } from "@suiem/shared/extension";
import { newId } from "@suiem/shared/ids";
import {
  extensionConfigResponse,
  installationsResponse,
  pairingCodeResponse,
  pairRequest,
  pairResponse,
  researchContextResponse,
} from "@suiem/shared/schemas";
import { eq } from "drizzle-orm";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { AuditService } from "../audit/audit.service";
import { ApiError } from "../http/errors";
import { Route } from "../http/route";
import { DB, ENV } from "../tokens";
import { RESEARCH, type ResearchRuntime } from "../research/runtime";
import { DevicesService } from "./devices.service";

export const actorUserId = (req: FastifyRequest): string => {
  const id = req.suiem.session?.userId ?? req.suiem.device?.userId;
  if (!id) throw new ApiError("UNAUTHENTICATED", "Sign in required");
  return id;
};

/** Mention rate limits the extension enforces locally (PRD §6.4). */
export const EXTENSION_RATE_LIMITS = { perEntityMinutes: 30, perDomainPerHour: 3 } as const;

@Controller()
export class ExtensionController {
  constructor(
    @Inject(DevicesService) private readonly devices: DevicesService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(DB) private readonly db: DbHandle,
    @Inject(ENV) private readonly env: ApiEnv,
    @Inject(RESEARCH) private readonly research: ResearchRuntime,
  ) {}

  @Route({
    method: "POST",
    path: "/extension/pairing-codes",
    summary: "One-time code to connect the browser extension (5 min, single use)",
    tags: ["extension"],
    auth: "user",
    response: pairingCodeResponse,
    status: 201,
  })
  async pairingCode(@Req() req: FastifyRequest) {
    const { code, expiresAt } = await this.devices.createPairingCode(req.suiem.session!.userId);
    return { code, expiresAt: expiresAt.toISOString(), extensionId: this.env.EXTENSION_ID ?? null };
  }

  @Route({
    method: "POST",
    path: "/extension/installations",
    summary: "Exchange a pairing code for a device token (called by the extension)",
    tags: ["extension", "auth"],
    auth: "public",
    extensionPublic: true,
    body: pairRequest,
    response: pairResponse,
    status: 201,
  })
  async pair(@Req() req: FastifyRequest) {
    const { pairingCode, label } = req.body as z.infer<typeof pairRequest>;
    const r = await this.devices.pair(pairingCode, label).catch(async (e: unknown) => {
      await this.audit.write({
        actorType: "anonymous",
        action: "extension.pair",
        outcome: "denied",
        requestId: req.suiem.requestId,
      });
      throw e;
    });
    await this.audit.write({
      actorType: "user",
      action: "extension.paired",
      outcome: "success",
      targetType: "extension_installation",
      targetId: r.installationId,
      requestId: req.suiem.requestId,
    });
    return r;
  }

  @Route({
    method: "GET",
    path: "/extension/installations",
    summary: "Connected browser extensions",
    tags: ["extension"],
    auth: "user",
    response: installationsResponse,
  })
  list(@Req() req: FastifyRequest) {
    return this.devices.list(req.suiem.session!.userId);
  }

  @Route({
    method: "DELETE",
    path: "/extension/installations/:id",
    summary: "Revoke an extension (web settings, or the extension itself)",
    tags: ["extension"],
    auth: "user_or_device",
  })
  async revoke(@Req() req: FastifyRequest, @Param("id") id: string) {
    if (!z.uuid().safeParse(id).success) throw new ApiError("NOT_FOUND", "Extension not found");
    if (req.suiem.device && req.suiem.device.installationId !== id)
      throw new ApiError("DEVICE_SCOPE", "An extension can only disconnect itself");
    await this.devices.revoke(actorUserId(req), id);
    await this.audit.write({
      actorType: "user",
      actorUserId: actorUserId(req),
      action: "extension.revoked",
      outcome: "success",
      targetType: "extension_installation",
      targetId: id,
      requestId: req.suiem.requestId,
    });
    return { ok: true };
  }

  @Route({
    method: "GET",
    path: "/extension/config",
    summary: "Thresholds, rate limits and dictionary version for the extension",
    tags: ["extension"],
    auth: "device",
    response: extensionConfigResponse,
  })
  async config(@Req() req: FastifyRequest) {
    const user = (
      await this.db.db
        .select({ handle: schema.users.handle })
        .from(schema.users)
        .where(eq(schema.users.id, req.suiem.device!.userId))
    )[0];
    return {
      notifyThreshold: NOTIFY_THRESHOLD,
      rateLimits: EXTENSION_RATE_LIMITS,
      dictionaryVersion: DICTIONARY_VERSION,
      handle: user?.handle ?? "",
      webOrigin: this.env.WEB_ORIGIN,
    };
  }

  @Route({
    method: "POST",
    path: "/extension/research-context",
    summary: "User-confirmed research request (entity, source URL, optional selected excerpt)",
    tags: ["extension"],
    auth: "device",
    body: researchContextRequest,
    response: researchContextResponse,
    status: 201,
  })
  async researchContext(@Req() req: FastifyRequest) {
    const body = req.body as z.infer<typeof researchContextRequest>;
    const entity = (
      await this.db.db
        .select({ id: schema.entities.id })
        .from(schema.entities)
        .where(eq(schema.entities.canonicalId, body.entityId))
    )[0];
    if (!entity) throw new ApiError("NOT_FOUND", "Unknown entity");
    const id = newId();
    const row = (
      await this.db.db
        .insert(schema.researchRequests)
        .values({
          id,
          userId: req.suiem.device!.userId,
          entityId: entity.id,
          installationId: req.suiem.device!.installationId,
          sourceUrl: body.sourceUrl,
          excerpt: body.selectedExcerpt ?? null,
        })
        .returning()
    )[0]!;
    await this.audit.write({
      actorType: "user",
      actorUserId: row.userId,
      action: "research.requested",
      outcome: "success",
      targetType: "research_request",
      targetId: id,
      requestId: req.suiem.requestId,
    });
    await this.research.enqueue(id);
    return {
      id: row.id,
      entityId: body.entityId,
      status: row.status,
      sourceUrl: row.sourceUrl,
      hasExcerpt: row.excerpt !== null,
      createdAt: row.createdAt.toISOString(),
      researchUrl: `${this.env.WEB_ORIGIN}/research/${encodeURIComponent(body.entityId)}`,
    };
  }

  @Route({
    method: "DELETE",
    path: "/extension/activity",
    summary: "Delete this user's extension research requests",
    tags: ["extension"],
    auth: "user_or_device",
  })
  async deleteActivity(@Req() req: FastifyRequest) {
    const r = await this.db.db
      .delete(schema.researchRequests)
      .where(eq(schema.researchRequests.userId, actorUserId(req)))
      .returning({ id: schema.researchRequests.id });
    await this.audit.write({
      actorType: "user",
      actorUserId: actorUserId(req),
      action: "extension.activity.deleted",
      outcome: "success",
      requestId: req.suiem.requestId,
      details: { count: r.length },
    });
    return { deleted: r.length };
  }
}
