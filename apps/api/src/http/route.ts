import { applyDecorators, Delete, Get, HttpCode, Patch, Post, SetMetadata } from "@nestjs/common";
import type { ZodType } from "zod";

/**
 * public: anyone · optional: session resolved if present · user: session required ·
 * device: extension device token required · user_or_device: either.
 * Device tokens are rejected (403 DEVICE_SCOPE) on every route that is not device/user_or_device.
 */
export type AuthLevel = "public" | "optional" | "user" | "device" | "user_or_device";

export interface RouteDef {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  /** Path below /api/v1, Fastify syntax (e.g. /wallet/link/:id). */
  path: string;
  summary: string;
  tags: string[];
  auth: AuthLevel;
  body?: ZodType;
  query?: ZodType;
  response?: ZodType;
  status?: number;
  /** Public endpoints called by the extension without cookies (pairing). Skips the web CSRF check. */
  extensionPublic?: boolean;
}

export const ROUTE_META = "suiem:route";
/** Registry used to generate the OpenAPI document. */
export const ROUTE_REGISTRY: RouteDef[] = [];

const METHOD = { GET: Get, POST: Post, PATCH: Patch, DELETE: Delete } as const;

/** Declares an endpoint once: Nest routing, auth level, validation and OpenAPI. */
export function Route(def: RouteDef): MethodDecorator {
  ROUTE_REGISTRY.push(def);
  return applyDecorators(
    METHOD[def.method](def.path),
    SetMetadata(ROUTE_META, def),
    HttpCode(def.status ?? 200),
  );
}
