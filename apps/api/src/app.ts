import "reflect-metadata";
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
    trustProxy: deps.env.NODE_ENV === "production",
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
