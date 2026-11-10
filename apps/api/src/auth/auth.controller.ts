import { Controller, Inject, Req, Res } from "@nestjs/common";
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { ApiEnv } from "@suiem/config/env";
import {
  csrfResponse,
  passkeyOptionsResponse,
  passkeyVerifyRequest,
  sessionResponse,
  siweNonceRequest,
  siweNonceResponse,
  siweVerifyRequest,
} from "@suiem/shared/schemas";
import type { FastifyReply, FastifyRequest } from "fastify";
import { randomBytes } from "node:crypto";
import type { Hex } from "viem";
import { AuditService } from "../audit/audit.service";
import { CSRF_COOKIE } from "../http/context";
import { Route } from "../http/route";
import { ENV } from "../tokens";
import { PasskeyService } from "./passkey.service";
import { SessionService } from "./session.service";
import { type SiweChainId, SiweService } from "./siwe.service";

type Amr = "passkey" | "siwe";

/**
 * Login = passkey or SIWE (ADR-0010 §4). PRD §15 `/auth/register` and `/auth/login` map to the
 * passkey register/login ceremonies and SIWE verify (which signs up on first use).
 */
@Controller()
export class AuthController {
  constructor(
    @Inject(PasskeyService) private readonly passkeys: PasskeyService,
    @Inject(SiweService) private readonly siwe: SiweService,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ENV) private readonly env: ApiEnv,
  ) {}

  private async startSession(
    req: FastifyRequest,
    reply: FastifyReply,
    userId: string,
    amr: Amr[],
    isNewUser: boolean,
    action: string,
  ) {
    const previous = req.suiem.session;
    const methods = previous && previous.userId === userId ? [...previous.amr, ...amr] : amr;
    const { token, session } = await this.sessions.create(userId, methods, previous?.sessionId);
    this.sessions.setCookie(reply, token, session.expiresAt);
    await this.audit.write({
      actorType: "user",
      actorUserId: userId,
      action,
      outcome: "success",
      requestId: req.suiem.requestId,
      details: { kind: amr.join(",") },
    });
    return { userId, authMethods: session.amr, isNewUser };
  }

  @Route({
    method: "GET",
    path: "/auth/csrf",
    summary: "Issue a CSRF token (double-submit cookie)",
    tags: ["auth"],
    auth: "public",
    response: csrfResponse,
  })
  csrf(@Res({ passthrough: true }) reply: FastifyReply) {
    const csrfToken = randomBytes(32).toString("base64url");
    void reply.setCookie(CSRF_COOKIE, csrfToken, {
      httpOnly: false,
      secure: this.env.COOKIE_SECURE,
      sameSite: "strict",
      path: "/",
    });
    return { csrfToken };
  }

  @Route({
    method: "POST",
    path: "/auth/passkey/register/options",
    summary: "Passkey registration options (sign up, or add to the signed-in account)",
    tags: ["auth"],
    auth: "optional",
    response: passkeyOptionsResponse,
  })
  async registerOptions(@Req() req: FastifyRequest) {
    return { options: await this.passkeys.registrationOptions(req.suiem.session?.userId) };
  }

  @Route({
    method: "POST",
    path: "/auth/passkey/register/verify",
    summary: "Verify passkey registration; signs up a new account",
    tags: ["auth"],
    auth: "optional",
    body: passkeyVerifyRequest,
    response: sessionResponse,
  })
  async registerVerify(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const body = req.body as { response: RegistrationResponseJSON };
    const r = await this.passkeys.verifyRegistration(body.response, req.suiem.session?.userId);
    return this.startSession(
      req,
      reply,
      r.userId,
      ["passkey"],
      r.isNewUser,
      r.isNewUser ? "auth.signup.passkey" : "auth.passkey.added",
    );
  }

  @Route({
    method: "POST",
    path: "/auth/passkey/login/options",
    summary: "Passkey login options",
    tags: ["auth"],
    auth: "public",
    response: passkeyOptionsResponse,
  })
  async loginOptions() {
    return { options: await this.passkeys.authenticationOptions() };
  }

  @Route({
    method: "POST",
    path: "/auth/passkey/login/verify",
    summary: "Verify passkey login",
    tags: ["auth"],
    auth: "optional",
    body: passkeyVerifyRequest,
    response: sessionResponse,
  })
  async loginVerify(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const body = req.body as { response: AuthenticationResponseJSON };
    const { userId } = await this.passkeys.verifyAuthentication(body.response);
    return this.startSession(req, reply, userId, ["passkey"], false, "auth.login.passkey");
  }

  @Route({
    method: "POST",
    path: "/auth/siwe/nonce",
    summary: "SIWE nonce for login (chain 4663 or 46630)",
    tags: ["auth"],
    auth: "public",
    body: siweNonceRequest,
    response: siweNonceResponse,
  })
  async siweNonce(@Req() req: FastifyRequest) {
    const { chainId } = req.body as { chainId: SiweChainId };
    return this.siwe.issueNonce(chainId, "login");
  }

  @Route({
    method: "POST",
    path: "/auth/siwe/verify",
    summary: "Sign in with Ethereum (creates the account on first use)",
    tags: ["auth"],
    auth: "optional",
    body: siweVerifyRequest,
    response: sessionResponse,
  })
  async siweVerify(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const { message, signature } = req.body as { message: string; signature: Hex };
    const { address, chainId } = await this.siwe
      .verify(message, signature, "login")
      .catch(async (e: unknown) => {
        await this.audit.write({
          actorType: "anonymous",
          action: "auth.login.siwe",
          outcome: "denied",
          requestId: req.suiem.requestId,
        });
        throw e;
      });
    const r = await this.siwe.loginOrSignup(address, chainId, message);
    return this.startSession(
      req,
      reply,
      r.userId,
      ["siwe"],
      r.isNewUser,
      r.isNewUser ? "auth.signup.siwe" : "auth.login.siwe",
    );
  }

  @Route({
    method: "POST",
    path: "/auth/logout",
    summary: "Revoke the current session",
    tags: ["auth"],
    auth: "user",
  })
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    await this.sessions.revoke(req.suiem.session!.sessionId);
    this.sessions.clearCookie(reply);
    return { ok: true };
  }
}
