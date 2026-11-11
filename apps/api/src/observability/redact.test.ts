import { Writable } from "node:stream";
import { describe, expect, test } from "vitest";
import { createLogger } from "./logger";
import { redact, scrubString } from "./redact";

describe("log redaction (allowlist)", () => {
  const capture = () => {
    const lines: string[] = [];
    const destination = new Writable({ write: (c, _e, cb) => (lines.push(String(c)), cb()) });
    return {
      logger: createLogger({ level: "info", service: "t", env: "test", destination }),
      lines,
    };
  };

  test("drops non-allowlisted keys and scrubs values under allowed keys", () => {
    const { logger, lines } = capture();
    logger.info(
      {
        requestId: "0196f3c2-7a7b-7c3d-8e9f-001122334455",
        cookie: "suiem_sid=abc",
        authorization: "Bearer x",
        address: "0x5173b8eA6923c2d40267890D45C46a3480954773",
        signature: "0xdeadbeef",
        route: "/me?x=alice@example.com",
        errMessage:
          "wallet 0x5173b8eA6923c2d40267890D45C46a3480954773 code 123456 token QWERTYUIOPASDFGHJKLZXCVBNM1234",
        pageText: "secret page text",
      },
      "user alice@example.com sent 0xabc123def4567890",
    );
    const out = lines.join("");
    expect(out).toContain("0196f3c2-7a7b-7c3d-8e9f-001122334455");
    for (const leaked of [
      "alice@example.com",
      "0x5173",
      "deadbeef",
      "123456",
      "QWERTYUIOP",
      "secret page text",
      "suiem_sid",
      "Bearer",
    ]) {
      expect(out, leaked).not.toContain(leaked);
    }
  });

  test("URL query strings and device tokens are scrubbed", () => {
    expect(scrubString("see https://x.com/a/status/1?ref=abc&u=me")).toBe(
      "see https://x.com/a/status/1?[query]",
    );
    expect(scrubString("token sxt_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA")).not.toContain(
      "AAAAAAAA",
    );
    expect(
      redact({ excerpt: "secret", sourceUrl: "https://x.com", token: "sxt_x", requestId: "r" }),
    ).toEqual({ requestId: "r" });
  });

  test("scrubString keeps UUIDs and plain text", () => {
    expect(scrubString("user 0196f3c2-7a7b-7c3d-8e9f-001122334455 ok")).toBe(
      "user 0196f3c2-7a7b-7c3d-8e9f-001122334455 ok",
    );
    expect(redact({ nested: { email: "a@b.co" } })).toEqual({});
  });
});

describe("RPC secrets in logs (Sprint 7)", () => {
  test("a QuickNode URL never reaches a log line or error fields", () => {
    const token = "abcdef0123456789abcdef0123456789abcdef01";
    const msg = `HTTP request failed. URL: https://name.robinhood-mainnet.quiknode.pro/${token}/`;
    expect(scrubString(msg)).not.toContain(token);
    expect(scrubString(msg)).not.toContain("quiknode.pro/");
    expect(scrubString(msg)).toContain("https://<quicknode>/…");
  });
});
