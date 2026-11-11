/** Sprint 6 rate limits with limits ENABLED: posts 10/h, comments 30/h, helpful votes 50/day. */
import { newId } from "@suiem/shared/ids";
import pg from "pg";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, expect, inject, test } from "vitest";
import { Client, type Harness, signSiwe, startHarness } from "./harness";

let h: Harness;
let owner: pg.Client;

beforeAll(async () => {
  h = await startHarness({ envOverrides: { RATE_LIMIT_DISABLED: "false" } });
  await h.redis.flushdb();
  owner = new pg.Client({ connectionString: inject("pgUrl") });
  await owner.connect();
});
afterAll(async () => {
  await owner?.end();
  await h?.close();
});

async function user() {
  const account = privateKeyToAccount(generatePrivateKey());
  const c = await new Client(h).init();
  const n = await c.request("POST", "/auth/siwe/nonce", { chainId: 46630 });
  expect(
    (await c.request("POST", "/auth/siwe/verify", await signSiwe(account, n.json as never))).status,
  ).toBe(200);
  return { c, id: (await c.request("GET", "/me")).json.id as string };
}

test("posts: 10 per hour", async () => {
  const a = await user();
  for (let i = 0; i < 10; i++)
    expect(
      (
        await a.c.request("POST", "/posts", {
          kind: "discussion",
          body: `p${i}`,
          visibility: "public",
        })
      ).status,
    ).toBe(201);
  const r = await a.c.request("POST", "/posts", {
    kind: "discussion",
    body: "one too many",
    visibility: "public",
  });
  expect(r.status).toBe(429);
  expect(r.raw.headers["retry-after"]).toBeDefined();
});

test("comments: 30 per hour", async () => {
  const a = await user();
  const b = await user();
  const p = (
    await b.c.request("POST", "/posts", { kind: "question", body: "?", visibility: "public" })
  ).json;
  for (let i = 0; i < 30; i++)
    expect((await a.c.request("POST", `/posts/${p.id}/comments`, { body: `c${i}` })).status).toBe(
      201,
    );
  expect((await a.c.request("POST", `/posts/${p.id}/comments`, { body: "x" })).status).toBe(429);
});

test("helpful votes: 50 per day", async () => {
  const a = await user();
  const b = await user();
  const ids: string[] = [];
  for (let i = 0; i < 51; i++) {
    const id = newId();
    ids.push(id);
    await owner.query(
      "INSERT INTO posts (id, user_id, kind, body, visibility) VALUES ($1, $2, 'discussion', $3, 'public')",
      [id, b.id, `n${i}`],
    );
  }
  for (const id of ids.slice(0, 50))
    expect((await a.c.request("POST", `/posts/${id}/reactions`, { kind: "helpful" })).status).toBe(
      200,
    );
  expect(
    (await a.c.request("POST", `/posts/${ids[50]}/reactions`, { kind: "helpful" })).status,
  ).toBe(429);
});
