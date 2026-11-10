import { Inject, Injectable } from "@nestjs/common";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import type { ApiEnv } from "@suiem/config/env";
import { type DbHandle, schema } from "@suiem/db";
import { newId } from "@suiem/shared/ids";
import { and, eq, isNull } from "drizzle-orm";
import type { Redis } from "ioredis";
import { ApiError } from "../http/errors";
import { DB, ENV, REDIS } from "../tokens";
import { putOnce, takeOnce } from "./challenges";
import { UsersService } from "./users.service";

const CHALLENGE_TTL = 300;

interface PendingRegistration {
  userId: string;
  handle: string;
  mode: "new" | "add";
}

function challengeOf(response: { response?: { clientDataJSON?: unknown } }): string {
  const raw = response.response?.clientDataJSON;
  if (typeof raw !== "string") throw new ApiError("PASSKEY_FAILED", "Malformed passkey response");
  try {
    const data = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as {
      challenge?: unknown;
    };
    if (typeof data.challenge !== "string") throw new Error("no challenge");
    return data.challenge;
  } catch {
    throw new ApiError("PASSKEY_FAILED", "Malformed passkey response");
  }
}

/**
 * WebAuthn passkeys (@simplewebauthn). Discoverable credentials and user verification are
 * required. Challenges are single use (Redis GETDEL) and expire after 5 minutes.
 */
@Injectable()
export class PasskeyService {
  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: ApiEnv,
    @Inject(UsersService) private readonly users: UsersService,
  ) {}

  /** `existingUserId` set: add a passkey to the signed-in account. Otherwise: sign up. */
  async registrationOptions(existingUserId?: string) {
    let pending: PendingRegistration;
    let exclude: { id: string; transports?: AuthenticatorTransport[] }[] = [];
    if (existingUserId) {
      const user = (
        await this.db.db
          .select({ handle: schema.users.handle })
          .from(schema.users)
          .where(eq(schema.users.id, existingUserId))
      )[0];
      if (!user) throw new ApiError("UNAUTHENTICATED", "Sign in required");
      pending = { userId: existingUserId, handle: user.handle, mode: "add" };
      const creds = await this.db.db
        .select({ id: schema.authMethods.credentialId, transports: schema.authMethods.transports })
        .from(schema.authMethods)
        .where(
          and(
            eq(schema.authMethods.userId, existingUserId),
            eq(schema.authMethods.kind, "passkey"),
            isNull(schema.authMethods.revokedAt),
          ),
        );
      exclude = creds
        .filter((c) => c.id)
        .map((c) => ({
          id: c.id!.toString("base64url"),
          transports: c.transports as AuthenticatorTransport[],
        }));
    } else {
      pending = { userId: newId(), handle: this.users.newHandle(), mode: "new" };
    }
    const options = await generateRegistrationOptions({
      rpName: this.env.WEBAUTHN_RP_NAME,
      rpID: this.env.WEBAUTHN_RP_ID,
      userName: pending.handle,
      userDisplayName: `Suiem ${pending.handle}`,
      userID: new TextEncoder().encode(pending.userId),
      attestationType: "none",
      excludeCredentials: exclude,
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      timeout: CHALLENGE_TTL * 1000,
    });
    await putOnce(this.redis, `wa:reg:${options.challenge}`, pending, CHALLENGE_TTL);
    return options;
  }

  async verifyRegistration(
    response: RegistrationResponseJSON,
    currentUserId?: string,
  ): Promise<{ userId: string; isNewUser: boolean }> {
    const challenge = challengeOf(response);
    const pending = await takeOnce<PendingRegistration>(this.redis, `wa:reg:${challenge}`);
    if (!pending) throw new ApiError("PASSKEY_FAILED", "Passkey challenge expired or already used");
    if (pending.mode === "add" && pending.userId !== currentUserId)
      throw new ApiError("PASSKEY_FAILED", "Passkey challenge belongs to another session");
    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: this.env.WEB_ORIGIN,
      expectedRPID: this.env.WEBAUTHN_RP_ID,
      requireUserVerification: true,
    }).catch(() => ({ verified: false as const, registrationInfo: undefined }));
    if (!verification.verified || !verification.registrationInfo)
      throw new ApiError("PASSKEY_FAILED", "Passkey could not be verified");
    const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    await this.db.db.transaction(async (tx) => {
      if (pending.mode === "new") await this.users.createInTx(tx, pending.userId, pending.handle);
      await tx.insert(schema.authMethods).values({
        id: newId(),
        userId: pending.userId,
        kind: "passkey",
        credentialId: Buffer.from(credential.id, "base64url"),
        publicKey: Buffer.from(credential.publicKey),
        signCount: BigInt(credential.counter),
        transports: credential.transports ?? [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
      });
    });
    return { userId: pending.userId, isNewUser: pending.mode === "new" };
  }

  async authenticationOptions() {
    const options = await generateAuthenticationOptions({
      rpID: this.env.WEBAUTHN_RP_ID,
      userVerification: "required",
      allowCredentials: [],
      timeout: CHALLENGE_TTL * 1000,
    });
    await putOnce(this.redis, `wa:auth:${options.challenge}`, { at: Date.now() }, CHALLENGE_TTL);
    return options;
  }

  async verifyAuthentication(response: AuthenticationResponseJSON): Promise<{ userId: string }> {
    const challenge = challengeOf(response);
    if (!(await takeOnce(this.redis, `wa:auth:${challenge}`)))
      throw new ApiError("PASSKEY_FAILED", "Passkey challenge expired or already used");
    if (typeof response.id !== "string")
      throw new ApiError("PASSKEY_FAILED", "Malformed passkey response");
    const method = (
      await this.db.db
        .select()
        .from(schema.authMethods)
        .where(
          and(
            eq(schema.authMethods.credentialId, Buffer.from(response.id, "base64url")),
            eq(schema.authMethods.kind, "passkey"),
            isNull(schema.authMethods.revokedAt),
          ),
        )
        .limit(1)
    )[0];
    if (!method?.publicKey) throw new ApiError("PASSKEY_FAILED", "Unknown passkey");
    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: this.env.WEB_ORIGIN,
      expectedRPID: this.env.WEBAUTHN_RP_ID,
      requireUserVerification: true,
      credential: {
        id: response.id,
        publicKey: new Uint8Array(method.publicKey),
        counter: Number(method.signCount),
        transports: method.transports as AuthenticatorTransport[],
      },
    }).catch(() => ({ verified: false as const, authenticationInfo: undefined }));
    if (!verification.verified || !verification.authenticationInfo)
      throw new ApiError("PASSKEY_FAILED", "Passkey could not be verified");
    await this.db.db
      .update(schema.authMethods)
      .set({
        signCount: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      })
      .where(eq(schema.authMethods.id, method.id));
    return { userId: method.userId };
  }
}
