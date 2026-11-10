import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { afterAll, describe, expect, inject, test } from "vitest";
import { bootstrap } from "../src/main";

/** Spawns a local anvil (no forking, nothing broadcast anywhere) reporting `chainId`. */
async function anvil(chainId: number): Promise<{ url: string; proc: ChildProcess }> {
  const port = await new Promise<number>((resolve) => {
    const s = createServer().listen(0, () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => resolve(p));
    });
  });
  const proc = spawn("anvil", ["--port", String(port), "--chain-id", String(chainId), "--silent"], {
    stdio: "ignore",
  });
  const url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    const ok = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}',
    })
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return { url, proc };
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("anvil did not start");
}

const procs: ChildProcess[] = [];
afterAll(() => procs.forEach((p) => p.kill()));

const baseEnv = () => ({
  NODE_ENV: "test",
  WEB_ORIGIN: "http://localhost:3000",
  DATABASE_URL: inject("pgAppUrl"),
  REDIS_URL: inject("redisUrl"),
  SESSION_SECRET: "test-session-secret-0123456789abcdef",
  WEBAUTHN_RP_ID: "localhost",
  API_PORT: "0",
  LOG_LEVEL: "silent",
});

describe("boot chain-ID check", () => {
  test("refuses to start when an RPC reports the wrong chain", async () => {
    const wrong = await anvil(1);
    const testnet = await anvil(46630);
    procs.push(wrong.proc, testnet.proc);
    await expect(
      bootstrap({ ...baseEnv(), MAINNET_RPC_URL: wrong.url, TESTNET_RPC_URL: testnet.url }),
    ).rejects.toThrow(/expected 4663/);
    await expect(
      bootstrap({ ...baseEnv(), MAINNET_RPC_URL: testnet.url, TESTNET_RPC_URL: testnet.url }),
    ).rejects.toThrow(/expected 4663/);
  });

  test("starts when both RPCs report 4663 and 46630", async () => {
    const mainnet = await anvil(4663);
    const testnet = await anvil(46630);
    procs.push(mainnet.proc, testnet.proc);
    const app = await bootstrap({
      ...baseEnv(),
      MAINNET_RPC_URL: mainnet.url,
      TESTNET_RPC_URL: testnet.url,
    });
    await app.close();
  });
});
