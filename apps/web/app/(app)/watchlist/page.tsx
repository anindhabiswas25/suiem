"use client";
import type { watchlistResponse } from "@suiem/shared/schemas";
import { EmptyState, ErrorState, LoadingState } from "@suiem/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { z } from "zod";
import { PageHeader } from "../../../components/AppShell";
import { api } from "../../../lib/api";

type Watchlist = z.infer<typeof watchlistResponse>;

export default function WatchlistPage() {
  const q = useQuery<Watchlist>({
    queryKey: ["watchlist"],
    queryFn: () => api("GET", "/watchlists/default"),
  });
  return (
    <>
      <PageHeader title="Watchlist">
        Companies you're following. Adding a company never buys anything.
      </PageHeader>
      {q.isPending ? <LoadingState /> : null}
      {q.isError ? (
        <ErrorState message="Could not load your watchlist." retry={() => void q.refetch()} />
      ) : null}
      {q.data && q.data.items.length === 0 ? (
        <EmptyState title="Your watchlist is empty">
          Add companies from the Suiem extension's research panel. Notes and thesis links arrive in
          Sprint 4.
        </EmptyState>
      ) : null}
      {q.data && q.data.items.length > 0 ? (
        <ul className="s-stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {q.data.items.map((i) => (
            <li key={i.id} className="s-card s-row" style={{ justifyContent: "space-between" }}>
              <Link href={`/research/${encodeURIComponent(i.entityId)}`}>
                <strong>{i.name}</strong>
              </Link>
              <span className="s-small s-muted">added {new Date(i.addedAt).toLocaleString()}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
