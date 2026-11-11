"use client";
import { decodeTrade, previewHash } from "@suiem/chain/write";
import { explorerTx } from "@suiem/shared/invest";
import type { orderResponse } from "@suiem/shared/schemas";
import { Alert, Button, Card, Status } from "@suiem/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { getAddress, type Hex, parseUnits } from "viem";
import { useAccount, useConnect, useSendTransaction, useSwitchChain } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import type { z } from "zod";
import { api, ApiRequestError } from "../../lib/api";
import { wagmiConfig } from "../../lib/wagmi";
import { type DecodedCall, type Preview, TicketView } from "./TicketView";

type Order = z.infer<typeof orderResponse>;
type Step = {
  label: string;
  state: "todo" | "doing" | "done" | "error";
  detail?: string;
  link?: string;
};
const TESTNET = 46630;
const errText = (e: unknown) =>
  e instanceof ApiRequestError
    ? e.message
    : e instanceof Error
      ? ((e as { shortMessage?: string }).shortMessage ?? e.message)
      : "Something went wrong";

/**
 * The client re-encodes nothing it trusts blindly: it recomputes the preview hash from the exact
 * calldata, decodes the call and checks trader, token and amount against the preview before the
 * wallet is ever asked to sign (Banchor R-1 regression).
 */
export function verifyPreview(
  p: Preview,
): { ok: true; decoded: DecodedCall | null } | { ok: false; reason: string } {
  if (!p.tx) return { ok: true, decoded: null };
  if (p.tx.chainId !== TESTNET) return { ok: false, reason: "Wrong network in the preview" };
  if (previewHash(TESTNET, getAddress(p.tx.to), p.tx.data as Hex, 0n) !== p.previewHash)
    return { ok: false, reason: "Preview hash does not match the transaction" };
  const d = decodeTrade(p.tx.data as Hex);
  const amountIn = parseUnits(p.amountIn.value, p.side === "buy" ? 6 : 18);
  if (d.functionName !== p.side)
    return { ok: false, reason: "Transaction side differs from the preview" };
  if (!p.trader || getAddress(d.quote.trader) !== getAddress(p.trader))
    return { ok: false, reason: "Transaction trader differs from your linked wallet" };
  if (!p.instrument.address || getAddress(d.quote.token) !== getAddress(p.instrument.address))
    return { ok: false, reason: "Transaction token differs from the instrument" };
  if (d.quote.amountIn !== amountIn)
    return { ok: false, reason: "Transaction amount differs from the preview" };
  if (p.route.venue && getAddress(p.tx.to) !== getAddress(p.route.venue))
    return { ok: false, reason: "Transaction target is not the venue" };
  return {
    ok: true,
    decoded: {
      functionName: d.functionName,
      trader: d.quote.trader,
      token: d.quote.token,
      amountIn: d.quote.amountIn.toString(),
      price: d.quote.price.toString(),
      minOut: d.minOut.toString(),
      expiry: new Date(Number(d.quote.expiry) * 1000).toISOString(),
    },
  };
}

export function OrderTicket({
  entityId,
  book,
  onClose,
}: {
  entityId: string;
  book: "testnet" | "simulated";
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState(book === "testnet" ? "10" : "100");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [ack, setAck] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [idemKey, setIdemKey] = useState("");
  const account = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const check = useMemo(() => (preview ? verifyPreview(preview) : null), [preview]);

  async function quote() {
    setBusy(true);
    setError(null);
    setSteps([]);
    setAck(false);
    try {
      const p = await api<Preview>("POST", "/orders/preview", {
        entityId,
        book,
        side,
        amount: amount.trim(),
      });
      setPreview(p);
      setIdemKey(`ord_${crypto.randomUUID().replace(/-/g, "")}`);
    } catch (e) {
      setPreview(null);
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const mark = (i: number, s: Partial<Step>) =>
    setSteps((all) => all.map((x, j) => (j === i ? { ...x, ...s } : x)));

  async function confirm() {
    if (!preview || !check?.ok) return;
    setBusy(true);
    setError(null);
    try {
      if (!preview.tx) {
        const o = await api<Order>(
          "POST",
          "/orders",
          { orderId: preview.orderId, previewHash: preview.previewHash, acknowledged: true },
          { "Idempotency-Key": idemKey },
        );
        setSteps([
          {
            label: `Paper trade ${o.status}`,
            state: o.status === "filled" ? "done" : "error",
            detail: o.filledOut ? `${o.filledOut.value} ${o.filledOut.asset}` : undefined,
          },
        ]);
        void qc.invalidateQueries({ queryKey: ["portfolio"] });
        return;
      }
      // Wallet: must be the linked wallet the quote was signed for, on testnet 46630.
      if (!account.address) await connectAsync({ connector: connectors[0]! });
      const connected = account.address ?? (await waitForAccount());
      if (getAddress(connected) !== getAddress(preview.trader!))
        throw new Error(`Switch your wallet to the linked address ${preview.trader}`);
      const plan: Step[] = [
        ...(preview.approval?.needed
          ? [{ label: `Approve exactly ${preview.approval.amount} dUSD`, state: "todo" as const }]
          : []),
        { label: "Order confirmed with Suiem", state: "todo" },
        { label: "Sign the trade in your wallet", state: "todo" },
        { label: "Submitted to testnet", state: "todo" },
        { label: "Reconciled by Suiem from the chain", state: "todo" },
      ];
      setSteps(plan);
      let i = 0;
      if (account.chainId !== TESTNET) await switchChainAsync({ chainId: TESTNET });
      if (preview.approval?.needed) {
        mark(i, { state: "doing" });
        const h = await sendTransactionAsync({
          to: getAddress(preview.approval.token),
          data: preview.approval.data as Hex,
          chainId: TESTNET,
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: h, chainId: TESTNET });
        mark(i++, { state: "done", link: explorerTx(h) });
      }
      mark(i, { state: "doing" });
      await api<Order>(
        "POST",
        "/orders",
        { orderId: preview.orderId, previewHash: preview.previewHash, acknowledged: true },
        { "Idempotency-Key": idemKey },
      );
      mark(i++, { state: "done" });
      mark(i, { state: "doing" });
      const hash = await sendTransactionAsync({
        to: getAddress(preview.tx.to),
        data: preview.tx.data as Hex,
        chainId: TESTNET,
      });
      mark(i++, { state: "done" });
      mark(i, { state: "doing", link: explorerTx(hash) });
      await waitForTransactionReceipt(wagmiConfig, { hash, chainId: TESTNET });
      let order: Order | null = null;
      for (let n = 0; n < 15 && !order; n++) {
        try {
          order = await api<Order>("POST", `/orders/${preview.orderId}/transactions`, {
            txHash: hash,
          });
        } catch (e) {
          if (!(e instanceof ApiRequestError && /not visible/.test(e.message))) throw e;
          await new Promise((r) => setTimeout(r, 1500));
        }
      }
      mark(i++, {
        state: "done",
        detail: "Included in a block (soft confirmation; posted to Ethereum within minutes)",
        link: explorerTx(hash),
      });
      for (let n = 0; n < 20 && order && order.status === "submitted"; n++) {
        await new Promise((r) => setTimeout(r, 1500));
        order = await api<Order>("GET", `/orders/${preview.orderId}`);
      }
      if (order?.status === "filled")
        mark(i, {
          state: "done",
          detail: `Received ${order.filledOut?.value} ${order.filledOut?.asset}`,
          link: explorerTx(hash),
        });
      else
        mark(i, {
          state: "error",
          detail: order?.failureReason ?? `Status: ${order?.status ?? "unknown"}`,
        });
      void qc.invalidateQueries({ queryKey: ["portfolio"] });
    } catch (e) {
      setError(errText(e));
      setSteps((all) => all.map((s) => (s.state === "doing" ? { ...s, state: "error" } : s)));
    } finally {
      setBusy(false);
    }
  }

  async function waitForAccount(): Promise<string> {
    for (let n = 0; n < 20; n++) {
      const a = (await import("wagmi/actions")).getAccount(wagmiConfig).address;
      if (a) return a;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error("Connect your wallet first");
  }

  return (
    <Card
      title={book === "testnet" ? "Buy or sell a demo token (testnet)" : "Paper trade (simulated)"}
    >
      <div className="s-row">
        <select
          className="s-select"
          value={side}
          onChange={(e) => (setSide(e.target.value as "buy" | "sell"), setPreview(null))}
          aria-label="Side"
        >
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
        <input
          className="s-input"
          value={amount}
          onChange={(e) => (setAmount(e.target.value), setPreview(null))}
          inputMode="decimal"
          aria-label="Amount"
          data-testid="ticket-amount"
          style={{ width: 140 }}
        />
        <span className="s-small s-muted">
          {side === "buy"
            ? book === "testnet"
              ? "dUSD to spend"
              : "USD to spend (paper)"
            : book === "testnet"
              ? "demo tokens to sell"
              : "shares to sell (paper)"}
        </span>
        <Button onClick={() => void quote()} loading={busy && !preview} data-testid="get-quote">
          Get quote
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
      {error ? <Alert tone="negative">{error}</Alert> : null}
      {preview && check && !check.ok ? (
        <Alert tone="negative">
          Preview integrity check failed: {check.reason}. Nothing was sent.
        </Alert>
      ) : null}
      {preview && check?.ok && steps.length === 0 ? (
        <TicketView
          preview={preview}
          now={now}
          acknowledged={ack}
          decoded={check.decoded}
          busy={busy}
          onAcknowledge={setAck}
          onRequote={() => void quote()}
          onConfirm={() => void confirm()}
        />
      ) : null}
      {steps.length ? (
        <ol className="s-stack" style={{ margin: 0, paddingLeft: 20 }} data-testid="order-timeline">
          {steps.map((s) => (
            <li key={s.label}>
              <Status
                tone={
                  s.state === "done"
                    ? "positive"
                    : s.state === "error"
                      ? "negative"
                      : s.state === "doing"
                        ? "warning"
                        : "neutral"
                }
              >
                {s.label}
              </Status>{" "}
              {s.detail ? <span className="s-small">{s.detail}</span> : null}{" "}
              {s.link ? (
                <a href={s.link} target="_blank" rel="noreferrer noopener" className="s-small">
                  view on explorer
                </a>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
    </Card>
  );
}
