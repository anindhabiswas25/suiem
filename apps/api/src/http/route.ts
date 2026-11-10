import { applyDecorators, Delete, Get, HttpCode, Patch, Post, SetMetadata } from "@nestjs/common";
import type { ZodType } from "zod";

/** public: anyone · optional: session resolved if present · user: session required. */
export type AuthLevel = "public" | "optional" | "user";

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
}

export const ROUTE_META = "suiem:route";
/** Registry used to generate the OpenAPI document. */
export const ROUTE_REGISTRY: RouteDef[] = [];

const METHOD = { GET: Get, POST: Post, PATCH: Patch, DELETE: Delete } as const;

/** Declares an endpoint once: Nest routing, auth level, validation and OpenAPI. */
export function Route(def: RouteDef): MethodDecorator {
  ROUTE_REGISTRY.push(def);
  return applyDecorators(METHOD[def.method](def.path), SetMetadata(ROUTE_META, def), HttpCode(def.status ?? 200));
}
