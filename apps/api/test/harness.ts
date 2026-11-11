import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import { loadApiEnv, type ApiEnv } from "@suiem/config/env";
import { connect, type DbHandle } from "@suiem/db";
import { Redis } from "ioredis";
import { Writable } from "node:stream";
import { createSiweMessage } from "viem/siwe";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { inject } from "vitest";
import { createApp } from "../src/app";
import { createLogger } from "../src/observability/logger";
import type { InvestRuntime } from "../src/orders/runtime";
import type { ResearchRuntime } from "../src/research/runtime";
import { systemClock, type Clock } from "../src/tokens";

export const WEB_ORIGIN = "http://localhost:3000";

export interface Harness {
  app: NestFastifyApplication;
  db: DbHandle;
  redis: Redis;
  env: ApiEnv;
  logs: string[];
  close(): Promise<void>;
}

export async function startHarness(
  options: {
    clock?: Clock;
    envOverrides?: Record<string, string>;
    /** Research runtime factory (fixture providers + mock models). Default: none configured. */
    research?: (db: DbHandle) => ResearchRuntime;
    /** Invest runtime (anvil testnet client, deployment, prices). */
    invest?: InvestRuntime;
  } = {},
): Promise<Harness> {
  const env = loadApiEnv({
    NODE_ENV: "test",
    WEB_ORIGIN,
    API_URL: "http://localhost:4000",
    DATABASE_URL: inject("pgAppUrl"),
    REDIS_URL: inject("redisUrl"),
    SESSION_SECRET: "test-session-secret-0123456789abcdef",
    COOKIE_SECURE: "false",
    WEBAUTHN_RP_ID: "localhost",
    RATE_LIMIT_DISABLED: "true",
    LOG_LEVEL: "info",
    ...options.envOverrides,
  });
  const db = connect(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL);
  const logs: string[] = [];
  const destination = new Writable({
    write(chunk, _enc, cb) {
      logs.push(String(chunk));
      cb();
    },
  });
  const logger = createLogger({ level: "info", service: "test", env: "test", destination });
  const app = await createApp({
    env,
    db,
    redis,
    logger,
    clock: options.clock ?? systemClock,
    research: options.research?.(db),
    invest: options.invest,
  });
  return {
    app,
    db,
    redis,
    env,
    logs,
    async close() {
      await app.close();
      await db.close();
      redis.disconnect();
    },
  };
}

/** A browser-like client: cookie jar, CSRF token, Origin header on writes. */
export class Client {
  private cookies = new Map<string, string>();
  csrf = "";
  constructor(private readonly h: Harness) {}

  private cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  async init() {
    const r = await this.request("GET", "/auth/csrf");
    this.csrf = (r.json as { csrfToken: string }).csrfToken;
    return this;
  }

  async request(
    method: string,
    path: string,
    body?: unknown,
    opts: { csrf?: string | null; origin?: string | null } = {},
  ) {
    const headers: Record<string, string> = { cookie: this.cookieHeader() };
    if (method !== "GET") {
      const csrf = opts.csrf === undefined ? this.csrf : opts.csrf;
      if (csrf !== null) headers["x-csrf-token"] = csrf;
      const origin = opts.origin === undefined ? WEB_ORIGIN : opts.origin;
      if (origin !== null) headers.origin = origin;
      if (body !== undefined) headers["content-type"] = "application/json";
    }
    const res = await this.h.app.inject({
      method: method as "GET",
      url: `/api/v1${path}`,
      headers,
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.cookies) {
      if (c.value === "" || (c.expires && new Date(c.expires).getTime() < Date.now()))
        this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    let json: unknown;
    try {
      json = res.json();
    } catch {
      json = undefined;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON access keeps tests readable
    return { status: res.statusCode, json: json as Record<string, any>, raw: res };
  }
}

/** Builds and signs a SIWE message locally with a throwaway key (no transaction, no network). */
export async function signSiwe(
  account: PrivateKeyAccount,
  nonce: {
    nonce: string;
    chainId: number;
    domain: string;
    uri: string;
    statement: string;
    issuedAt: string;
    expirationTime: string;
  },
  tamper: Partial<{
    chainId: number;
    domain: string;
    uri: string;
    issuedAt: Date;
    expirationTime: Date;
  }> = {},
) {
  const message = createSiweMessage({
    address: account.address,
    chainId: tamper.chainId ?? nonce.chainId,
    domain: tamper.domain ?? nonce.domain,
    uri: tamper.uri ?? nonce.uri,
    nonce: nonce.nonce,
    version: "1",
    statement: nonce.statement,
    issuedAt: tamper.issuedAt ?? new Date(nonce.issuedAt),
    expirationTime: tamper.expirationTime ?? new Date(nonce.expirationTime),
  });
  return { message, signature: await account.signMessage({ message }) };
}

export const newWallet = () => privateKeyToAccount(generatePrivateKey());
