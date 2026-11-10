import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ApiEnv } from "@suiem/config/env";
import type { FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { SessionService } from "../auth/session.service";
import { LIMITS, RateLimiter } from "../infra/rate-limit";
import { ENV } from "../tokens";
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from "./context";
import { ApiError } from "./errors";
import { ROUTE_META, type RouteDef } from "./route";

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

function sameToken(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * One global guard, in this order:
 * 1. per-IP rate limit; 2. on every write: Origin must equal WEB_ORIGIN and the double-submit
 * CSRF token (cookie + X-CSRF-Token header) must match; 3. resolve the session cookie;
 * 4. enforce the route's auth level. Routes without @Route metadata are denied.
 */
@Injectable()
export class SecurityGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(ENV) private readonly env: ApiEnv,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const route = this.reflector.get<RouteDef | undefined>(ROUTE_META, context.getHandler());
    if (!route) throw new ApiError("NOT_FOUND", "Not found");

    await this.limiter.consume(LIMITS.globalPerIp, req.ip);
    if (route.tags.includes("auth")) await this.limiter.consume(LIMITS.authPerIp, req.ip);

    if (!SAFE.has(req.method)) {
      if (req.headers.origin !== this.env.WEB_ORIGIN)
        throw new ApiError("CSRF_FAILED", "Cross-origin write rejected");
      const header = req.headers[CSRF_HEADER];
      if (!sameToken(req.cookies[CSRF_COOKIE], typeof header === "string" ? header : undefined)) {
        throw new ApiError("CSRF_FAILED", "Missing or invalid CSRF token");
      }
    }

    if (route.auth !== "public") {
      const session = await this.sessions.resolve(req.cookies[SESSION_COOKIE]);
      if (session) req.suiem.session = session;
      if (route.auth === "user" && !session)
        throw new ApiError("UNAUTHENTICATED", "Sign in required");
      if (session && !SAFE.has(req.method))
        await this.limiter.consume(LIMITS.writesPerUser, session.userId);
    }
    return true;
  }
}
