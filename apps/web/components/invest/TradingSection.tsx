"use client";
import type { instrumentsResponse, investStatusResponse } from "@suiem/shared/schemas";
import { Button, Card, LoadingState, NetworkBadge, Status } from "@suiem/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import type { z } from "zod";
import { api } from "../../lib/api";
import { GetDemoDusd } from "./GetDemoDusd";
import { OrderTicket } from "./OrderTicket";

type Status = z.infer<typeof investStatusResponse>;
type Instruments = z.infer<typeof instrumentsResponse>;

/**
 * Trading on the research page. Shows a button only when the instrument is resolved and active,
 * the flags allow it and the declared country is eligible; otherwise it says why. Nothing here
 * ever trades automatically: every order is previewed, confirmed and signed by the user.
 */
export function TradingSection({ entityId }: { entityId: string }) {
  const status = useQuery<Status>({
    queryKey: ["invest-status"],
    queryFn: () => api("GET", "/invest/status"),
  });
  const instruments = useQuery<Instruments>({
    queryKey: ["instruments", entityId],
    queryFn: () => api("GET", `/entities/${encodeURIComponent(entityId)}/instruments`),
  });
  const [open, setOpen] = useState<"testnet" | "simulated" | null>(null);
  if (status.isPending || instruments.isPending) return <LoadingState />;
  const items = instruments.data?.items ?? [];
  const demo = items.find((i) => i.legalType === "demo_token");
  const faucet = items.find((i) => i.legalType === "testnet_test_token");
  const sim = items.find((i) => i.legalType === "simulated");
  const s = status.data;
  const demoReason = !demo
    ? "There is no testnet token for this company (test tokens exist for TSLA, AMZN, PLTR, NFLX and AMD)."
    : demo.status !== "active"
      ? "The test token for this company is not deployed or not verified yet."
      : (s?.testnet.reason ?? null);
  return (
    <Card title="Trading">
      <ul className="s-stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {items.map((i) => (
          <li key={i.id} className="s-row">
            <strong>{i.symbol}</strong>
            <span className="s-muted">{i.label}</span>
            <NetworkBadge network={i.network} />
          </li>
        ))}
      </ul>
      <div className="s-row">
        {demo && !demoReason ? (
          <Button variant="primary" onClick={() => setOpen("testnet")} data-testid="buy-demo">
            Buy test token (testnet)
          </Button>
        ) : null}
        {sim ? (
          <Button onClick={() => setOpen("simulated")} data-testid="paper-trade">
            Paper trade (simulated)
          </Button>
        ) : null}
      </div>
      {demoReason ? <Status tone="neutral">Testnet: {demoReason}</Status> : null}
      {s?.eligibility.message && demoReason !== s.eligibility.message ? (
        <Status tone="warning">{s.eligibility.message}</Status>
      ) : null}
      {s?.eligibility.reason === "jurisdiction_not_declared" ? (
        <Link href="/settings">Declare your country in Settings</Link>
      ) : null}
      {demo && !demoReason && s?.testnet.dusd ? (
        <GetDemoDusd dusd={s.testnet.dusd} faucetUrl={s.testnet.faucetUrl} />
      ) : null}
      {faucet ? (
        <span className="s-small s-muted">
          Robinhood's official testnet test token ({faucet.symbol}) is shown read-only in your
          portfolio; Suiem never trades it.
        </span>
      ) : null}
      {open ? <OrderTicket entityId={entityId} book={open} onClose={() => setOpen(null)} /> : null}
      <span className="s-small s-muted">
        Testnet tokens have no value and are not shares or securities. Paper trades buy nothing.{" "}
        <Link href="/portfolio">Your portfolio</Link>
      </span>
    </Card>
  );
}
