"use client";
import type {
  entitySummary,
  instrumentsResponse,
  researchRequestsResponse,
} from "@suiem/shared/schemas";
import { Card, EmptyState, ErrorState, LoadingState, NetworkBadge, Status } from "@suiem/ui";
import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import type { z } from "zod";
import { PageHeader } from "../../../../components/AppShell";
import { api } from "../../../../lib/api";

type Entity = z.infer<typeof entitySummary>;
type Instruments = z.infer<typeof instrumentsResponse>;
type Requests = z.infer<typeof researchRequestsResponse>;

export default function ResearchEntity() {
  const params = useParams<{ entityId: string }>();
  const id = decodeURIComponent(params.entityId);
  const entity = useQuery<Entity>({
    queryKey: ["entity", id],
    queryFn: () => api("GET", `/entities/${encodeURIComponent(id)}`),
  });
  const instruments = useQuery<Instruments>({
    queryKey: ["instruments", id],
    queryFn: () => api("GET", `/entities/${encodeURIComponent(id)}/instruments`),
  });
  const requests = useQuery<Requests>({
    queryKey: ["requests", id],
    queryFn: () => api("GET", `/research/requests?entityId=${encodeURIComponent(id)}`),
  });

  if (entity.isPending) return <LoadingState />;
  if (entity.isError || !entity.data)
    return (
      <ErrorState title="Unknown company" message="This company is not in the Suiem registry." />
    );
  const e = entity.data;

  return (
    <>
      <PageHeader title={e.name}>
        {e.legalName} · {e.kind} · {e.sector} · {e.tickers.join(" · ")}
      </PageHeader>
      <Card title="Instruments">
        {instruments.isPending ? <LoadingState /> : null}
        {instruments.data?.items.length === 0 ? (
          <span className="s-muted">No registry instruments for this company yet.</span>
        ) : null}
        <ul className="s-stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {instruments.data?.items.map((i) => (
            <li key={i.id} className="s-row">
              <strong>{i.symbol}</strong>
              <span className="s-muted">{i.label}</span>
              <NetworkBadge network={i.network} />
            </li>
          ))}
        </ul>
        <span className="s-small s-muted">
          Testnet tokens have no value and are not securities or shares. Ordering arrives in Sprint
          5.
        </span>
      </Card>
      <Card title="Your research requests">
        {requests.isPending ? <LoadingState /> : null}
        {requests.data?.items.length === 0 ? (
          <EmptyState title="No research requested yet">
            Use the Suiem extension's research panel to request a brief for this company.
          </EmptyState>
        ) : null}
        <ul className="s-stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {requests.data?.items.map((r) => (
            <li key={r.id} className="s-row">
              <Status tone="warning">Queued</Status>
              <span className="s-small">
                {new Date(r.createdAt).toLocaleString()} · source {new URL(r.sourceUrl).hostname}
                {r.hasExcerpt ? " · with your selected text" : ""}
              </span>
            </li>
          ))}
        </ul>
        <span className="s-small s-muted">
          The AI brief generator arrives in Sprint 4. Queued requests will turn into cited briefs
          here.
        </span>
      </Card>
    </>
  );
}
