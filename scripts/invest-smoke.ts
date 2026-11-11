// Live testnet check (manual, NOT CI). Uses a throwaway test wallet (INVEST_SMOKE_PRIVATE_KEY,
// funded from the official faucet; never the deployer) against a running dev stack:
// SIWE sign-in → declare country → claim dUSD → buy dTSLA (exact approve) → server reconcile → sell.
// Prints only addresses, statuses and tx hashes. Chain 46630 only.
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  type Hex,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";

const API = process.env.LIVE_API ?? "http://localhost:3000/api/v1";
const RPC = process.env.TESTNET_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com";
const key = process.env.INVEST_SMOKE_PRIVATE_KEY as Hex | undefined;
if (!key) throw new Error("INVEST_SMOKE_PRIVATE_KEY is not set");
const account = privateKeyToAccount(key);
const chain = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});
const pub = createPublicClient({ chain, transport: http(RPC) });
if ((await pub.getChainId()) !== 46630) throw new Error("RPC is not chain 46630");
const wallet = createWalletClient({ account, chain, transport: http(RPC) });
const explorer = (h: string) => `https://explorer.testnet.chain.robinhood.com/tx/${h}`;
const hashes: Record<string, string> = {};

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON from our own API
type Json = any;
let cookie = "";
let csrf = "";
async function call(
  method: string,
  path: string,
  body?: unknown,
  extra: Record<string, string> = {},
): Promise<{ status: number; json: Json }> {
  const headers: Record<string, string> = { cookie, origin: new URL(API).origin, ...extra };
  if (method !== "GET") headers["x-csrf-token"] = csrf;
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const c of r.headers.getSetCookie()) {
    const kv = c.split(";")[0]!;
    const k = kv.split("=")[0]!;
    cookie = [...cookie.split("; ").filter((x) => x && !x.startsWith(`${k}=`)), kv].join("; ");
  }
  const text = await r.text();
  return { status: r.status, json: text ? JSON.parse(text) : {} };
}
const ok = <T>(r: { status: number; json: T }, what: string) => {
  if (r.status >= 300) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};

console.log(
  `wallet ${account.address} · ETH ${await pub.getBalance({ address: account.address })} wei`,
);
csrf = (await call("GET", "/auth/csrf")).json.csrfToken;
const n = (await call("POST", "/auth/siwe/nonce", { chainId: 46630 })).json;
const message = createSiweMessage({
  ...n,
  version: "1",
  address: account.address,
  issuedAt: new Date(n.issuedAt),
  expirationTime: new Date(n.expirationTime),
});
ok(
  await call("POST", "/auth/siwe/verify", {
    message,
    signature: await account.signMessage({ message }),
  }),
  "sign-in",
);
csrf = (await call("GET", "/auth/csrf")).json.csrfToken;
ok(
  await call("PATCH", "/me", { jurisdiction: process.env.SMOKE_COUNTRY ?? "IN" }),
  "declare country",
);
const status = ok(await call("GET", "/invest/status"), "status");
if (!status.testnet.available) throw new Error(`testnet unavailable: ${status.testnet.reason}`);
const dusd = getAddress(status.testnet.dusd);

// 1. claim dUSD (skips if on cooldown)
try {
  const h = await wallet.writeContract({
    address: dusd,
    abi: [
      { type: "function", name: "claim", inputs: [], outputs: [], stateMutability: "nonpayable" },
    ],
    functionName: "claim",
  });
  await pub.waitForTransactionReceipt({ hash: h });
  hashes.claim = h;
  console.log(`claim dUSD      ${explorer(h)}`);
} catch (e) {
  console.log(
    `claim skipped: ${(e as { shortMessage?: string }).shortMessage ?? (e as Error).message}`,
  );
}

async function trade(side: "buy" | "sell", amount: string) {
  const p = ok(
    await call("POST", "/orders/preview", { entityId: "ent:tesla", book: "testnet", side, amount }),
    `${side} preview`,
  );
  console.log(
    `${side} preview    ${p.amountIn.value} ${p.amountIn.asset} → ≈${p.estimatedOut.value} ${p.estimatedOut.asset} @ USD ${p.price.value} (${p.price.source}) · min ${p.minOut.value}`,
  );
  if (p.approval?.needed) {
    const h = await wallet.sendTransaction({
      to: getAddress(p.approval.token),
      data: p.approval.data,
    });
    await pub.waitForTransactionReceipt({ hash: h });
    hashes[`${side}-approve`] = h;
    console.log(`approve exact    ${explorer(h)}`);
  }
  ok(
    await call(
      "POST",
      "/orders",
      { orderId: p.orderId, previewHash: p.previewHash, acknowledged: true },
      { "idempotency-key": `smoke_${crypto.randomUUID().replace(/-/g, "")}` },
    ),
    `${side} confirm`,
  );
  const h = await wallet.sendTransaction({ to: getAddress(p.tx.to), data: p.tx.data });
  await pub.waitForTransactionReceipt({ hash: h });
  hashes[side] = h;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON
  let o: any = null;
  for (let i = 0; i < 20 && !o; i++) {
    const r = await call("POST", `/orders/${p.orderId}/transactions`, { txHash: h });
    if (r.status < 300) o = r.json;
    else if (!/not visible/.test(JSON.stringify(r.json))) throw new Error(JSON.stringify(r.json));
    else await new Promise((res) => setTimeout(res, 1500));
  }
  for (let i = 0; i < 20 && o?.status === "submitted"; i++) {
    await new Promise((res) => setTimeout(res, 1500));
    o = (await call("GET", `/orders/${p.orderId}`)).json;
  }
  console.log(
    `${side} ${o?.status.padEnd(11)} ${explorer(h)} · received ${o?.filledOut?.value} ${o?.filledOut?.asset}`,
  );
  if (o?.status !== "filled") throw new Error(`${side} not filled: ${o?.failureReason}`);
  return o;
}

const bought = await trade("buy", process.env.SMOKE_BUY_DUSD ?? "25");
await trade("sell", (Number(bought.filledOut.value) / 2).toFixed(6)); // display-only maths in a script
const port = ok(await call("GET", "/portfolio"), "portfolio");
const pos = port.books.testnet.positions.find(
  (x: { instrumentSymbol: string }) => x.instrumentSymbol === "DEMO:TSLA",
);
console.log(
  `portfolio        DEMO:TSLA qty ${pos?.quantity} · avg cost ${pos?.averageCost?.value} dUSD · realized ${pos?.realizedPnl.value} dUSD`,
);
console.log(
  `faucet holdings  ${port.books.faucet.positions.map((x: { instrumentSymbol: string; quantity: string }) => `${x.instrumentSymbol}=${x.quantity}`).join(", ") || port.books.faucet.note}`,
);
console.log(`TX HASHES ${JSON.stringify(hashes)}`);
