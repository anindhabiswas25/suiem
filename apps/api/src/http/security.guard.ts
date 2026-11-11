import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { ApiEnv } from "@suiem/config/env";
import type { FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { SessionService } from "../auth/session.service";
import { DevicesService } from "../extension/devices.service";
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
    @Inject(DevicesService) private readonly devices: DevicesService,
    @Inject(RateLimiter) private readonly limiter: RateLimiter,
    @Inject(ENV) private readonly env: ApiEnv,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const route = this.reflector.get<RouteDef | undefined>(ROUTE_META, context.getHandler());
    if (!route) throw new ApiError("NOT_FOUND", "Not found");

    await this.limiter.consume(LIMITS.globalPerIp, req.ip);
    if (route.tags.includes("auth")) await this.limiter.consume(LIMITS.authPerIp, req.ip);

    // Extension device tokens: Authorization: Bearer sxt_… (no cookies, so CSRF does not apply).
    const auth = req.headers.authorization;
    const bearer =
      typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : undefined;
    const deviceRoute = route.auth === "device" || route.auth === "user_or_device";
    if (bearer !== undefined || route.extensionPublic) {
      if (bearer !== undefined && !deviceRoute) {
        throw new ApiError("DEVICE_SCOPE", "Extension tokens can only call extension endpoints");
      }
      // Writes (incl. pairing) must come from the configured extension. Chrome omits Origin on GETs
      // from extension pages, so a GET may lack it, but any Origin that IS present must match.
      if (this.env.EXTENSION_ID) {
        const expected = `chrome-extension://${this.env.EXTENSION_ID}`;
        const origin = req.headers.origin;
        if (
          SAFE.has(req.method) ? origin !== undefined && origin !== expected : origin !== expected
        ) {
          throw new ApiError("FORBIDDEN", "Unknown extension origin");
        }
      }
      if (bearer !== undefined) {
        const device = await this.devices.resolve(bearer);
        if (!device)
          throw new ApiError(
            "UNAUTHENTICATED",
            "Extension token is invalid or revoked. Reconnect the extension.",
          );
        req.suiem.device = device;
        await this.limiter.consume(LIMITS.writesPerUser, device.userId);
        return true;
      }
      return true; // extensionPublic without a token (pairing exchange): rate-limited above
    }
    if (route.auth === "device") throw new ApiError("UNAUTHENTICATED", "Extension token required");

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
      if ((route.auth === "user" || route.auth === "user_or_device") && !session)
        throw new ApiError("UNAUTHENTICATED", "Sign in required");
      if (session && !SAFE.has(req.method))
        await this.limiter.consume(LIMITS.writesPerUser, session.userId);
    }
    return true;
  }
}
