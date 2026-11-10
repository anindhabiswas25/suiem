import { Inject, Injectable } from "@nestjs/common";
import type { ApiEnv } from "@suiem/config/env";
import { type DbHandle, schema } from "@suiem/db";
import { newId } from "@suiem/shared/ids";
import { and, eq, isNull } from "drizzle-orm";
import type { Redis } from "ioredis";
import { createHash } from "node:crypto";
import { getAddress, verifyMessage, type Address, type Hex } from "viem";
import { generateSiweNonce, parseSiweMessage } from "viem/siwe";
import { ApiError } from "../http/errors";
import { CLOCK, type Clock, DB, ENV, REDIS } from "../tokens";
import { putOnce, takeOnce } from "./challenges";
import { UsersService } from "./users.service";

export const SIWE_CHAINS = [4663, 46630] as const;
export type SiweChainId = (typeof SIWE_CHAINS)[number];
export const NONCE_TTL_SECONDS = 600;
/** Messages must expire within this window of issuedAt. */
export const MAX_MESSAGE_LIFETIME_MS = 15 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;
export const SIWE_STATEMENT =
  "Sign in to Suiem. This signature proves you control this wallet. It is not a transaction and costs nothing.";

interface NonceRecord {
  chainId: SiweChainId;
  purpose: "login" | "link";
  userId?: string;
}

/**
 * Sign-In With Ethereum (EIP-4361) for login and wallet linking (ADR-0010 §4).
 * Checks: domain and URI equal WEB_ORIGIN, version 1, chainId 4663 or 46630 (and equal to the
 * nonce's), single-use server nonce bound to purpose (and session for linking), issuedAt not in
 * the future, expirationTime required and in the future, notBefore honoured, then signature.
 * EOA signatures only (no smart accounts in the hackathon build).
 */
@Injectable()
export class SiweService {
  private readonly origin: URL;

  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) env: ApiEnv,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(UsersService) private readonly users: UsersService,
  ) {
    this.origin = new URL(env.WEB_ORIGIN);
  }

  async issueNonce(chainId: SiweChainId, purpose: NonceRecord["purpose"], userId?: string) {
    const nonce = generateSiweNonce();
    const now = this.clock.now();
    await putOnce(
      this.redis,
      `siwe:${nonce}`,
      { chainId, purpose, userId } satisfies NonceRecord,
      NONCE_TTL_SECONDS,
    );
    return {
      nonce,
      chainId,
      domain: this.origin.host,
      uri: this.origin.origin,
      statement: SIWE_STATEMENT,
      issuedAt: now.toISOString(),
      expirationTime: new Date(now.getTime() + NONCE_TTL_SECONDS * 1000).toISOString(),
    };
  }

  /** Validates and consumes the message. Returns the verified address and chain. */
  async verify(
    message: string,
    signature: Hex,
    purpose: NonceRecord["purpose"],
    userId?: string,
  ): Promise<{ address: Address; chainId: SiweChainId }> {
    const fail = (why: string): never => {
      throw new ApiError("SIWE_INVALID", `Sign-in message rejected: ${why}`);
    };
    let parsed: ReturnType<typeof parseSiweMessage>;
    try {
      parsed = parseSiweMessage(message);
    } catch {
      return fail("malformed message");
    }
    if (!parsed.nonce) fail("missing nonce");
    // Consume the nonce first: any later failure still burns it, so a message can never be replayed.
    const record = await takeOnce<NonceRecord>(this.redis, `siwe:${parsed.nonce}`);
    if (!record) fail("unknown, expired or already used nonce");
    if (record!.purpose !== purpose) fail("nonce was issued for a different purpose");
    if (purpose === "link" && record!.userId !== userId) fail("nonce belongs to another session");
    if (parsed.domain !== this.origin.host) fail("wrong domain");
    if (!parsed.uri || new URL(parsed.uri).origin !== this.origin.origin) fail("wrong URI");
    if (parsed.version !== "1") fail("unsupported version");
    if (
      parsed.chainId === undefined ||
      !(SIWE_CHAINS as readonly number[]).includes(parsed.chainId)
    )
      fail("unsupported chain");
    if (parsed.chainId !== record!.chainId) fail("chain does not match the nonce");
    const now = this.clock.now().getTime();
    if (!parsed.issuedAt || parsed.issuedAt.getTime() > now + CLOCK_SKEW_MS)
      fail("issuedAt is in the future");
    if (!parsed.expirationTime) fail("expirationTime is required");
    if (parsed.expirationTime!.getTime() <= now) fail("message expired");
    if (parsed.expirationTime!.getTime() - parsed.issuedAt!.getTime() > MAX_MESSAGE_LIFETIME_MS)
      fail("message lifetime too long");
    if (parsed.notBefore && parsed.notBefore.getTime() > now + CLOCK_SKEW_MS)
      fail("message not yet valid");
    if (!parsed.address) fail("missing address");
    const address = getAddress(parsed.address!);
    const valid = await verifyMessage({ address, message, signature }).catch(() => false);
    if (!valid) fail("signature does not match address");
    return { address, chainId: parsed.chainId as SiweChainId };
  }

  messageHash(message: string): Buffer {
    return createHash("sha256").update(message).digest();
  }

  /** SIWE login: returns the wallet's user, creating an account on first sign-in. */
  async loginOrSignup(
    address: Address,
    chainId: SiweChainId,
    message: string,
  ): Promise<{ userId: string; isNewUser: boolean }> {
    const addr = Buffer.from(address.slice(2), "hex");
    const existing = (
      await this.db.db
        .select({ userId: schema.walletAccounts.userId })
        .from(schema.walletAccounts)
        .where(
          and(eq(schema.walletAccounts.address, addr), isNull(schema.walletAccounts.unlinkedAt)),
        )
        .limit(1)
    )[0];
    if (existing) return { userId: existing.userId, isNewUser: false };
    const userId = await this.db.db.transaction(async (tx) => {
      const id = await this.users.createInTx(tx);
      const walletId = newId();
      await tx.insert(schema.walletAccounts).values({
        id: walletId,
        userId: id,
        address: addr,
        chainId,
        siweMessageHash: this.messageHash(message),
      });
      await tx
        .insert(schema.authMethods)
        .values({ id: newId(), userId: id, kind: "siwe", walletAccountId: walletId });
      return id;
    });
    return { userId, isNewUser: true };
  }

  /** Links an additional wallet to the signed-in user. */
  async link(userId: string, address: Address, chainId: SiweChainId, message: string) {
    const addr = Buffer.from(address.slice(2), "hex");
    const id = newId();
    try {
      await this.db.db.transaction(async (tx) => {
        await tx.insert(schema.walletAccounts).values({
          id,
          userId,
          address: addr,
          chainId,
          siweMessageHash: this.messageHash(message),
        });
        await tx
          .insert(schema.authMethods)
          .values({ id: newId(), userId, kind: "siwe", walletAccountId: id });
      });
    } catch (error) {
      const cause = (error as { cause?: { code?: string } }).cause ?? (error as { code?: string });
      if (cause?.code === "23505")
        throw new ApiError("WALLET_ALREADY_LINKED", "This wallet is already linked to an account");
      throw error;
    }
    return id;
  }
}
