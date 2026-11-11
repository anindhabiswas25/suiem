"use client";
import type {
  portfolioHistoryResponse,
  portfolioResponse,
  portfolioTransactionsResponse,
} from "@suiem/shared/schemas";
import { Card, EmptyState, ErrorState, LoadingState, NetworkBadge, Status } from "@suiem/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { z } from "zod";
import { PageHeader } from "../../../components/AppShell";
import { formatDecimal } from "../../../components/research/ui";
import { api } from "../../../lib/api";

type Portfolio = z.infer<typeof portfolioResponse>;
type Book = Portfolio["books"]["simulated"];

const NETWORK: Record<Book["book"], "testnet" | "offchain"> = {
  simulated: "offchain",
  testnet: "testnet",
  faucet: "testnet",
};
const EMPTY: Record<Book["book"], string> = {
  simulated:
    "No paper trades yet. Open a company's research page and choose Paper trade (simulated).",
  testnet:
    "No demo tokens yet. Get demo dUSD and buy a demo token on a TSLA, AMZN, PLTR, NFLX or AMD research page.",
  faucet: "No faucet test tokens found in your linked wallet.",
};
const money = (m: { value: string; currency: string } | null) =>
  m ? `${formatDecimal(m.value)} ${m.currency}` : "—";

export default function PortfolioPage() {
  const p = useQuery<Portfolio>({
    queryKey: ["portfolio"],
    queryFn: () => api("GET", "/portfolio"),
  });
  const tx = useQuery<z.infer<typeof portfolioTransactionsResponse>>({
    queryKey: ["portfolio", "tx"],
    queryFn: () => api("GET", "/portfolio/transactions"),
  });
  const hist = useQuery<z.infer<typeof portfolioHistoryResponse>>({
    queryKey: ["portfolio", "history"],
    queryFn: () => api("GET", "/portfolio/history"),
  });
  return (
    <>
      <PageHeader title="Portfolio">
        Three separate books. They are never added together, and none of them holds real shares or
        securities.
      </PageHeader>
      {p.isPending ? <LoadingState /> : null}
      {p.isError ? (
        <ErrorState message="Could not load your portfolio." retry={() => void p.refetch()} />
      ) : null}
      {p.data ? (
        <>
          {(["testnet", "simulated", "faucet"] as const).map((k) => (
            <BookCard
              key={k}
              b={p.data.books[k]}
              history={k === "faucet" ? undefined : hist.data?.books[k]}
            />
          ))}
          <Card title="How P&L is calculated">
            <span className="s-small">{p.data.methodology}</span>
          </Card>
        </>
      ) : null}
      <Card title="Orders and transactions">
        <div className="s-row">
          <a href="/api/v1/portfolio/export" className="s-small" data-testid="csv-export">
            Download CSV
          </a>
        </div>
        {tx.data?.items.length === 0 ? (
          <span className="s-muted s-small">No orders yet.</span>
        ) : null}
        <div className="table-wrap">
          <table className="figures">
            <tbody>
              {tx.data?.items.map((o) => (
                <tr key={o.id} data-testid="tx-row">
                  <td className="s-small">{new Date(o.createdAt).toLocaleString()}</td>
                  <td>
                    <span className="s-badge" data-tone="neutral">
                      {o.bookLabel}
                    </span>
                  </td>
                  <td>
                    {o.side}{" "}
                    {o.entityId ? (
                      <Link href={`/research/${encodeURIComponent(o.entityId)}`}>{o.symbol}</Link>
                    ) : (
                      o.symbol
                    )}
                  </td>
                  <td className="s-small">
                    {o.amountIn.value} {o.amountIn.asset} →{" "}
                    {o.filledOut
                      ? `${o.filledOut.value} ${o.filledOut.asset}`
                      : `≈ ${o.estimatedOut.value} ${o.estimatedOut.asset}`}
                  </td>
                  <td>
                    <Status
                      tone={
                        o.status === "filled"
                          ? "positive"
                          : o.status === "failed" || o.status === "expired"
                            ? "negative"
                            : "warning"
                      }
                    >
                      {o.status}
                    </Status>
                    {o.failureReason ? <span className="s-small"> {o.failureReason}</span> : null}
                  </td>
                  <td className="s-small">
                    {o.explorerUrl ? (
                      <a href={o.explorerUrl} target="_blank" rel="noreferrer noopener">
                        explorer
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

function BookCard({ b, history }: { b: Book; history?: { at: string; value: string }[] }) {
  return (
    <Card title={b.label}>
      <div className="s-row">
        <NetworkBadge network={NETWORK[b.book]} />
        <span className="s-badge" data-tone="neutral" data-testid={`book-${b.book}`}>
          {b.label}
        </span>
      </div>
      {b.note ? <span className="s-small s-muted">{b.note}</span> : null}
      {b.positions.length === 0 ? (
        <EmptyState title="Nothing here yet">{EMPTY[b.book]}</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="figures">
            <thead>
              <tr>
                <th>Instrument</th>
                <th>Quantity</th>
                <th>Avg cost</th>
                <th>Value</th>
                <th>Unrealized</th>
                <th>Realized</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {b.positions.map((x) => (
                <tr key={x.instrumentSymbol} data-testid="position">
                  <td>
                    {x.entityId ? (
                      <Link href={`/research/${encodeURIComponent(x.entityId)}`}>
                        {x.displayName}
                      </Link>
                    ) : (
                      x.displayName
                    )}
                    <div className="s-small s-muted">{x.instrumentSymbol}</div>
                  </td>
                  <td className="num">{formatDecimal(x.quantity)}</td>
                  <td className="num">{money(x.averageCost)}</td>
                  <td className="num">{money(x.marketValue)}</td>
                  <td className="num">{money(x.unrealizedPnl)}</td>
                  <td className="num">{b.book === "faucet" ? "—" : money(x.realizedPnl)}</td>
                  <td className="s-small">
                    {x.price
                      ? `USD ${x.price.value} · ${new Date(x.price.at).toLocaleString()} · ${x.price.source}`
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {b.totals ? (
        <span className="s-small">
          Book total ({b.label}): cost {money(b.totals.costBasis)} · value{" "}
          {money(b.totals.marketValue)} · unrealized {money(b.totals.unrealizedPnl)} · realized{" "}
          {money(b.totals.realizedPnl)}
        </span>
      ) : null}
      {history && history.length > 1 ? (
        <span className="s-small s-muted">
          History:{" "}
          {history
            .map((h) => `${new Date(h.at).toLocaleDateString()} ${formatDecimal(h.value)}`)
            .join(" → ")}
        </span>
      ) : null}
    </Card>
  );
}
