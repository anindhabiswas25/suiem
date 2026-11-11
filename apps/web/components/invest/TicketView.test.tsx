import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { type Preview, secondsLeft, TicketView } from "./TicketView";

const NOW = Date.parse("2026-11-11T10:00:00Z");
const preview: Preview = {
  orderId: "01a1c95b-0000-7000-8000-000000000001",
  book: "testnet",
  bookLabel: "Testnet demo · no value",
  side: "buy",
  instrument: {
    symbol: "DEMO:TSLA",
    displayName: "Suiem Demo TSLA (testnet, no value)",
    legalTypeLabel: "Suiem demo token · testnet · no value · not a security",
    network: "testnet",
    chainId: 46630,
    address: "0x0000000000000000000000000000000000000001",
  },
  amountIn: { value: "100", asset: "dUSD" },
  estimatedOut: { value: "0.3996", asset: "dTSLA" },
  minOut: { value: "0.397602", asset: "dTSLA" },
  fee: { value: "0.1", asset: "dUSD", bps: 10 },
  slippageBps: 50,
  price: {
    value: "250",
    executionPrice: "250",
    currency: "USD",
    at: "2026-11-11T09:59:59Z",
    source: "Finnhub (free tier)",
    sourceUrl: "https://finnhub.io",
  },
  expiresAt: new Date(NOW + 55_000).toISOString(),
  route: {
    venue: "0x0000000000000000000000000000000000000002",
    explorerUrl: "https://explorer.testnet.chain.robinhood.com/address/0x2",
    description: "SuiemDemoVenue on Robinhood Chain testnet (46630)",
  },
  trader: "0x0000000000000000000000000000000000000003",
  approval: { needed: true, token: "0x4", spender: "0x2", amount: "100", data: "0x" },
  tx: {
    chainId: 46630,
    to: "0x0000000000000000000000000000000000000002",
    data: "0xabcd",
    value: "0",
  },
  previewHash: `0x${"a".repeat(64)}`,
  simulation: {
    ran: false,
    ok: true,
    detail: "Runs in your wallet after the exact-amount approval",
  },
  checks: [{ name: "Jurisdiction", ok: true, detail: "eligible" }],
  risks: ["No value, not a security."],
};
const noop = () => {};
const render = (p: Partial<Parameters<typeof TicketView>[0]>) =>
  renderToStaticMarkup(
    <TicketView
      preview={preview}
      now={NOW}
      acknowledged={false}
      decoded={null}
      busy={false}
      onAcknowledge={noop}
      onRequote={noop}
      onConfirm={noop}
      {...p}
    />,
  );

describe("order ticket", () => {
  test("expiry countdown counts down and floors at zero", () => {
    expect(secondsLeft(preview.expiresAt, NOW)).toBe(55);
    expect(secondsLeft(preview.expiresAt, NOW + 54_100)).toBe(1);
    expect(secondsLeft(preview.expiresAt, NOW + 90_000)).toBe(0);
    expect(render({})).toContain("Quote valid for 55s");
    expect(render({ now: NOW + 50_000 })).toContain("Quote valid for 5s");
  });

  test("an expired quote offers only a re-quote, never a confirm", () => {
    const html = render({ now: NOW + 56_000, acknowledged: true });
    expect(html).toContain("Quote expired");
    expect(html).toContain('data-testid="requote"');
    expect(html).not.toContain('data-testid="confirm-order"');
  });

  test("confirmation is required: the confirm button is disabled until acknowledged", () => {
    const off = render({ acknowledged: false });
    expect(off).toMatch(/<button[^>]*disabled=""[^>]*data-testid="confirm-order"/);
    expect(off).toContain(
      "I understand this is a testnet demo token with no value and not a security.",
    );
    const on = render({ acknowledged: true });
    expect(on).not.toMatch(/<button[^>]*disabled=""[^>]*data-testid="confirm-order"/);
  });

  test("shows every preview field, the exact approval and the network", () => {
    const html = render({});
    for (const s of [
      "DEMO:TSLA",
      "no value · not a security",
      "Robinhood Chain testnet (46630)",
      "100 dUSD",
      "0.3996 dTSLA",
      "0.397602 dTSLA",
      "0.5% max slippage",
      "0.1 dUSD (0.1%)",
      "Finnhub (free tier)",
      "SuiemDemoVenue",
      "Exact-amount approval of 100 dUSD",
      "never unlimited",
    ])
      expect(html).toContain(s);
  });

  test("simulated ticket uses paper-trade wording", () => {
    const html = render({
      preview: { ...preview, book: "simulated", bookLabel: "Simulated", tx: null, approval: null },
      acknowledged: true,
    });
    expect(html).toContain("Place paper trade");
    expect(html).toContain("nothing is bought and no money moves");
    expect(html).not.toContain("Approval");
  });
});
