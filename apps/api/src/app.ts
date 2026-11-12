import "reflect-metadata";
import { timingSafeEqual } from "node:crypto";
import fastifyCookie from "@fastify/cookie";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { newId } from "@suiem/shared/ids";
import { AppModule, type AppDeps } from "./app.module";
import "./http/context";

export const API_PREFIX = "api/v1";

export async function createApp(deps: AppDeps): Promise<NestFastifyApplication> {
  const adapter = new FastifyAdapter({
    bodyLimit: 64 * 1024,
    // Exact hop count only: trusting every X-Forwarded-For hop would let clients spoof their IP
    // and bypass per-IP rate limits (security review).
    trustProxy: (_addr: string, hop: number) => hop < deps.env.TRUST_PROXY_HOPS,
    genReqId: () => newId(),
    logger: false,
  });
  const app = await NestFactory.create<NestFastifyApplication>(AppModule.forRoot(deps), adapter, {
    logger: false,
    abortOnError: false,
  });
  app.setGlobalPrefix(API_PREFIX);
  await app.register(fastifyCookie);
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook("onRequest", async (req, reply) => {
    req.suiem = { requestId: String(req.id), startedAt: process.hrtime.bigint() };
    void reply.header("x-request-id", req.suiem.requestId);
    void reply.header("cache-control", "no-store");
    void reply.header("x-content-type-options", "nosniff");
    // Only the web proxy may call the API when a shared secret is configured (health stays open
    // for the platform's health check).
    const secret = deps.env.PROXY_SHARED_SECRET;
    if (secret && !(req.method === "GET" && req.url === `/${API_PREFIX}/health`)) {
      const got = Buffer.from(String(req.headers["x-suiem-proxy"] ?? ""));
      const want = Buffer.from(secret);
      if (got.length !== want.length || !timingSafeEqual(got, want)) {
        return reply.code(403).send({
          error: { code: "FORBIDDEN", message: "Forbidden", requestId: req.suiem.requestId },
        });
      }
    }
  });
  fastify.addHook("onResponse", async (req, reply) => {
    const durationMs = Number(
      (process.hrtime.bigint() - (req.suiem?.startedAt ?? process.hrtime.bigint())) / 1_000_000n,
    );
    deps.logger.info(
      {
        requestId: req.suiem?.requestId,
        method: req.method,
        route: req.routeOptions?.url ?? "unmatched",
        statusCode: reply.statusCode,
        durationMs,
        userId: req.suiem?.session?.userId,
      },
      "request",
    );
  });
  await app.init();
  await fastify.ready();
  return app;
}
