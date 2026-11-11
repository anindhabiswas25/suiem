// Manual live check against a running dev stack (not CI): SIWE sign-in, request a brief over HTTP,
// poll until the inline BullMQ worker finishes, then ask a follow-up and run compare.
// Prints only statuses and counts. Usage: pnpm --filter @suiem/api exec tsx src/scripts/live-check.ts ent:microsoft
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const BASE = process.env.LIVE_API ?? "http://localhost:3000/api/v1";
const ORIGIN = new URL(BASE).origin;
const entityId = process.argv[2] ?? "ent:microsoft";
let cookie = "";
let csrf = "";
async function call(method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { cookie, origin: ORIGIN };
  if (method !== "GET") headers["x-csrf-token"] = csrf;
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const c of r.headers.getSetCookie()) {
    const [kv] = c.split(";");
    const [k] = kv!.split("=");
    cookie = [...cookie.split("; ").filter((x) => x && !x.startsWith(`${k}=`)), kv].join("; ");
  }
  const text = await r.text();
  return { status: r.status, json: (text ? JSON.parse(text) : {}) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
}
csrf = (await call("GET", "/auth/csrf")).json.csrfToken;
const account = privateKeyToAccount(generatePrivateKey());
const n = (await call("POST", "/auth/siwe/nonce", { chainId: 46630 })).json;
const message = createSiweMessage({
  ...n,
  version: "1",
  address: account.address,
  issuedAt: new Date(n.issuedAt),
  expirationTime: n.expirationTime ? new Date(n.expirationTime) : undefined,
} as never);
const v = await call("POST", "/auth/siwe/verify", {
  message,
  signature: await account.signMessage({ message }),
});
console.log("sign-in", v.status);
csrf = (await call("GET", "/auth/csrf")).json.csrfToken;
const q = await call("POST", "/research/briefs", { entityId });
console.log("request", q.status, q.json.status);
const t0 = Date.now();
let item: Record<string, any> = {}; // eslint-disable-line @typescript-eslint/no-explicit-any
while (Date.now() - t0 < 180_000) {
  item = (await call("GET", `/research/requests?entityId=${entityId}`)).json.items[0];
  if (item.status === "completed" || item.status === "failed") break;
  await new Promise((r) => setTimeout(r, 2000));
}
console.log(
  "request final",
  item.status,
  item.failureReason ?? "",
  `${Math.round((Date.now() - t0) / 1000)}s`,
);
if (item.status !== "completed") process.exit(1);
const b = (await call("GET", `/research/briefs/${item.briefId}`)).json;
console.log("brief", {
  provider: b.provider,
  model: b.model,
  freshness: b.dataFreshness,
  sources: b.brief.sources.length,
  figures: b.brief.financialHighlights.length,
  risks: b.brief.risks.length,
});
const a = await call("POST", `/research/briefs/${item.briefId}/questions`, {
  question: "How much did revenue grow last fiscal year?",
});
console.log(
  "follow-up",
  a.status,
  a.json.insufficientSources ?? a.json.error?.code,
  a.json.claims?.length,
  a.json.provider,
);
const c = await call("POST", "/research/compare", { entityIds: [entityId, "ent:nvidia"] });
console.log(
  "compare",
  c.status,
  c.json.rows
    ?.find((r: { metric: string }) => r.metric === "revenue")
    ?.cells.map((x: { value: string | null }) => x.value),
);
const qt = await call("GET", `/entities/${entityId}/quote`);
console.log("quote", qt.status, qt.json.source, qt.json.asOf);
