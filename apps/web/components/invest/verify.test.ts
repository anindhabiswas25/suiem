import { encodeTrade, previewHash, signQuote } from "@suiem/chain/write";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, test } from "vitest";
import { verifyPreview } from "./OrderTicket";
import type { Preview } from "./TicketView";

const venue = "0x00000000000000000000000000000000000000aa" as const;
const token = "0x00000000000000000000000000000000000000bb" as const;
const trader = privateKeyToAccount(generatePrivateKey()).address;

async function makePreview(): Promise<Preview> {
  const q = {
    trader,
    token,
    side: 0 as const,
    amountIn: 100_000_000n,
    price: 250_000_000n,
    feeBps: 10,
    expiry: 1_800_000_000n,
    nonce: 7n,
  };
  const sig = await signQuote(generatePrivateKey(), 46630, venue, q);
  const data = encodeTrade(q, sig, 1n);
  return {
    orderId: "01a1c95b-0000-7000-8000-000000000001",
    book: "testnet",
    bookLabel: "Testnet demo · no value",
    side: "buy",
    instrument: {
      symbol: "DEMO:TSLA",
      displayName: "d",
      legalTypeLabel: "l",
      network: "testnet",
      chainId: 46630,
      address: token,
    },
    amountIn: { value: "100", asset: "dUSD" },
    estimatedOut: { value: "0.3996", asset: "dTSLA" },
    minOut: { value: "0.000000000000000001", asset: "dTSLA" },
    fee: { value: "0.1", asset: "dUSD", bps: 10 },
    slippageBps: 50,
    price: {
      value: "250",
      executionPrice: "250",
      currency: "USD",
      at: "2026-11-11T00:00:00Z",
      source: "s",
      sourceUrl: "u",
    },
    expiresAt: "2026-11-11T00:01:00Z",
    route: { venue, explorerUrl: null, description: "venue" },
    trader,
    approval: null,
    tx: { chainId: 46630, to: venue, data, value: "0" },
    previewHash: previewHash(46630, venue, data, 0n),
    simulation: { ran: false, ok: true, detail: "" },
    checks: [],
    risks: [],
  };
}

describe("client-side preview integrity (re-encode, compare hash, decode)", () => {
  test("an untampered preview passes and is decoded for display", async () => {
    const r = verifyPreview(await makePreview());
    expect(r.ok).toBe(true);
    expect(r.ok && r.decoded).toMatchObject({
      functionName: "buy",
      trader,
      token,
      amountIn: "100000000",
      price: "250000000",
    });
  });
  test.each([
    [
      "amount shown differs",
      (p: Preview) => ({ ...p, amountIn: { ...p.amountIn, value: "1" } }),
      /amount/,
    ],
    [
      "recipient (trader) differs",
      (p: Preview) => ({ ...p, trader: privateKeyToAccount(generatePrivateKey()).address }),
      /trader/,
    ],
    ["target differs", (p: Preview) => ({ ...p, tx: { ...p.tx!, to: token } }), /hash/],
    [
      "calldata swapped",
      (p: Preview) => ({
        ...p,
        tx: {
          ...p.tx!,
          data: `${p.tx!.data.slice(0, 200)}${p.tx!.data[200] === "f" ? "e" : "f"}${p.tx!.data.slice(201)}`,
        },
      }),
      /hash/,
    ],
    ["wrong network", (p: Preview) => ({ ...p, tx: { ...p.tx!, chainId: 4663 } }), /network/],
    [
      "token differs",
      (p: Preview) => ({ ...p, instrument: { ...p.instrument, address: venue } }),
      /token/,
    ],
  ])("tamper detected: %s", async (_name, tamper, reason) => {
    const r = verifyPreview(tamper(await makePreview()));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(reason);
  });
});
