import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createPublicClient } from "viem";
import { describe, expect, test } from "vitest";
import { redactError, redactRpcSecrets, rpcLabel, secretHttp } from "./rpc";

const TOKEN = "0123456789abcdef0123456789abcdef01234567";

describe("RPC secret redaction", () => {
  test("QuickNode and Alchemy URLs are scrubbed from text", () => {
    const text = `request to https://some-name.robinhood-mainnet.quiknode.pro/${TOKEN}/ failed; also https://robinhood-mainnet.g.alchemy.com/v2/${TOKEN}`;
    const out = redactRpcSecrets(text);
    expect(out).not.toContain(TOKEN);
    expect(out).toContain("https://<quicknode>/…");
    expect(out).toContain("alchemy.com/v2/<key>");
    expect(rpcLabel(`https://x.quiknode.pro/${TOKEN}/`)).toBe("quicknode");
  });

  test("errors and their cause chain are redacted", () => {
    const inner = new Error(`fetch https://a.quiknode.pro/${TOKEN}/ ECONNRESET`);
    const outer = Object.assign(
      new Error(`HTTP request failed. URL: https://a.quiknode.pro/${TOKEN}/`),
      {
        cause: inner,
        url: `https://a.quiknode.pro/${TOKEN}/`,
        metaMessages: [`URL: https://a.quiknode.pro/${TOKEN}/`],
      },
    );
    redactError(outer);
    expect(
      JSON.stringify({
        m: outer.message,
        u: outer.url,
        mm: outer.metaMessages,
        s: outer.stack,
        c: inner.message,
        cs: inner.stack,
      }),
    ).not.toContain(TOKEN);
  });

  test("a real viem client error through secretHttp never contains the secret URL", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(500, { "content-type": "text/plain" }).end("boom");
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}/${TOKEN}/`;
    const client = createPublicClient({ transport: secretHttp(url, { retryCount: 0, maxRps: 0 }) });
    let caught: unknown;
    try {
      await client.getChainId();
    } catch (e) {
      caught = e;
    } finally {
      server.close();
    }
    expect(caught).toBeInstanceOf(Error);
    const e = caught as Error & { details?: string; shortMessage?: string };
    const all = [
      e.message,
      e.stack,
      e.details,
      e.shortMessage,
      String((e.cause as Error)?.message),
    ].join("\n");
    expect(all).not.toContain(TOKEN);
    expect(all).toContain("<rpc>");
  });

  test("pacing limits the request rate", async () => {
    let hits = 0;
    const server = createServer((req, res) => {
      hits++;
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const { id } = JSON.parse(body) as { id: number };
        res
          .writeHead(200, { "content-type": "application/json" })
          .end(JSON.stringify({ jsonrpc: "2.0", id, result: "0x1237" }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as AddressInfo).port;
    const client = createPublicClient({
      transport: secretHttp(`http://127.0.0.1:${port}/`, { maxRps: 20 }),
      cacheTime: 0,
    });
    const t0 = Date.now();
    await Promise.all(Array.from({ length: 6 }, () => client.request({ method: "eth_chainId" })));
    server.close();
    expect(hits).toBe(6);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(240); // 6 requests at 20/s → ≥ 250 ms (minus jitter)
  });
});
