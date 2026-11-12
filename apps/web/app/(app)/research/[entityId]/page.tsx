"use client";
import type {
  briefListResponse,
  briefResponse,
  entitySummary,
  questionItem,
  quoteResponse,
  researchRequestsResponse,
  watchlistsResponse,
} from "@suiem/shared/schemas";
import { Alert, Button, Card, EmptyState, ErrorState, LoadingState, Status } from "@suiem/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { z } from "zod";
import { PageHeader } from "../../../../components/AppShell";
import { TradingSection } from "../../../../components/invest/TradingSection";
import {
  AiLabel,
  type Brief,
  ClaimList,
  FigureTable,
  RequestStatus,
} from "../../../../components/research/ui";
import { api, ApiRequestError } from "../../../../lib/api";

type Entity = z.infer<typeof entitySummary>;
type Requests = z.infer<typeof researchRequestsResponse>;
type BriefRow = z.infer<typeof briefResponse>;
type Question = z.infer<typeof questionItem>;

const errText = (e: unknown) =>
  e instanceof ApiRequestError ? e.message : "Something went wrong. Please try again.";

export default function ResearchEntity() {
  const params = useParams<{ entityId: string }>();
  const id = decodeURIComponent(params.entityId);
  const enc = encodeURIComponent(id);
  const qc = useQueryClient();

  const entity = useQuery<Entity>({
    queryKey: ["entity", id],
    queryFn: () => api("GET", `/entities/${enc}`),
  });
  const requests = useQuery<Requests>({
    queryKey: ["requests", id],
    queryFn: () => api("GET", `/research/requests?entityId=${enc}`),
    // Poll while something is queued or processing.
    refetchInterval: (q) =>
      q.state.data?.items.some((r) => r.status === "queued" || r.status === "processing")
        ? 2500
        : false,
  });
  const latestId = requests.data?.items.find((r) => r.status === "completed")?.briefId ?? null;
  const fallbackList = useQuery<z.infer<typeof briefListResponse>>({
    queryKey: ["briefs", id],
    queryFn: () => api("GET", `/research/briefs?entityId=${enc}&limit=1`),
    enabled: !latestId && requests.isSuccess,
  });
  const briefId = latestId ?? fallbackList.data?.items[0]?.id ?? null;
  const brief = useQuery<BriefRow>({
    queryKey: ["brief", briefId],
    queryFn: () => api("GET", `/research/briefs/${briefId}`),
    enabled: !!briefId,
  });

  const request = useMutation({
    mutationFn: () => api("POST", "/research/briefs", { entityId: id }),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["requests", id] }),
  });

  if (entity.isPending) return <LoadingState />;
  if (entity.isError || !entity.data)
    return (
      <ErrorState title="Unknown company" message="This company is not in the Suiem registry." />
    );
  const e = entity.data;
  const latestRequest = requests.data?.items[0];
  const busy =
    latestRequest && (latestRequest.status === "queued" || latestRequest.status === "processing");

  return (
    <>
      <PageHeader title={e.name} eyebrow="Research">
        {e.legalName} · {e.kind} · {e.sector} · {e.tickers.join(" · ")}
      </PageHeader>

      <Card title="AI research brief">
        <div className="s-row">
          <Button
            variant="primary"
            onClick={() => request.mutate()}
            loading={request.isPending || !!busy}
            data-testid="request-brief"
          >
            {brief.data ? "Request a fresh brief" : "Request AI research"}
          </Button>
          <span className="s-small s-muted">
            Uses public data only (SEC EDGAR filings, Finnhub market data and news). Free AI tiers:
            Groq, with Google Gemini as fallback; Gemini's free tier may use inputs to improve
            Google products. Limit: a few briefs per day.
          </span>
        </div>
        {request.isError ? <Alert tone="negative">{errText(request.error)}</Alert> : null}
        {latestRequest ? (
          <RequestStatus
            r={latestRequest}
            onRetry={() => request.mutate()}
            retrying={request.isPending}
          />
        ) : null}
        {!briefId && requests.isSuccess && !busy ? (
          <EmptyState title="No brief yet">
            Request one above, or from the Suiem extension's research panel.
          </EmptyState>
        ) : null}
      </Card>

      {brief.isPending && briefId ? <LoadingState label="Loading brief…" /> : null}
      {brief.data ? <BriefView row={brief.data} entityId={id} /> : null}

      <WatchlistAction entityId={id} />

      <Card title="Notes and thesis">
        <span className="s-small">
          Write your own thesis: direction, horizon, evidence from this brief, counterarguments and
          what would prove you wrong. It stays private until you publish it.
        </span>
        <div className="s-row">
          <Link
            className="s-btn"
            data-variant="primary"
            href={`/theses/new?entityId=${enc}${briefId ? `&briefId=${briefId}` : ""}`}
            data-testid="create-thesis"
          >
            Create a thesis
          </Link>
        </div>
      </Card>

      <TradingSection entityId={id} />
    </>
  );
}

function BriefView({ row, entityId }: { row: BriefRow; entityId: string }) {
  const b = row.brief as unknown as Brief;
  const s = b.sources;
  const quote = useQuery<z.infer<typeof quoteResponse>>({
    queryKey: ["quote", entityId],
    queryFn: () => api("GET", `/entities/${encodeURIComponent(entityId)}/quote`),
    retry: false,
  });
  return (
    <>
      <Card title="Overview">
        <div className="s-row">
          <AiLabel
            model={row.model}
            provider={row.provider}
            generatedAt={row.generatedAt}
            cached={row.cached}
          />
          <Status tone="warning">Not investment advice</Status>
          <Status tone={b.dataFreshness === "fresh" ? "positive" : "warning"}>
            Data: {b.dataFreshness}
          </Status>
        </div>
        <p style={{ margin: 0 }} data-testid="brief-summary">
          {b.summary}
        </p>
        {quote.data ? (
          <span className="s-small" data-testid="quote">
            Last price USD {quote.data.price} ({quote.data.changePercent ?? "—"}%) at{" "}
            {new Date(quote.data.asOf).toLocaleString()} · {quote.data.source}
          </span>
        ) : null}
        <span className="s-small s-muted">{b.disclaimer}</span>
      </Card>
      <Card title="Business model">
        <ClaimList claims={b.businessModel} sources={s} />
      </Card>
      <Card title="Financials">
        <span className="s-small s-muted">
          Computed by Suiem from SEC filings (not by the AI). Values in full units; hover a value
          for the exact figure.
        </span>
        <FigureTable figures={b.financialHighlights} sources={s} />
      </Card>
      <Card title="Valuation">
        <span className="s-small s-muted">
          As published by Finnhub (free tier), labelled with its as-of date.
        </span>
        <FigureTable figures={b.valuation} sources={s} />
      </Card>
      <Card title="Industry context">
        <ClaimList claims={b.industryContext} sources={s} />
      </Card>
      <Card title="Competitors">
        <ClaimList claims={b.competitors} sources={s} />
      </Card>
      <Card title="Latest news">
        <ClaimList
          claims={b.recentDevelopments}
          sources={s}
          empty="No recent news in the sources."
        />
      </Card>
      <Card title="Risks and bear case">
        <ClaimList claims={b.risks} sources={s} />
        <h3 style={{ margin: "8px 0 0", fontSize: 15 }}>Bear case</h3>
        <ClaimList claims={b.bearCase} sources={s} />
      </Card>
      <Card title="Scenarios">
        <div className="grid2">
          <div>
            <h3 style={{ margin: 0, fontSize: 15 }}>Bull</h3>
            <ClaimList claims={b.bullCase} sources={s} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 15 }}>Base</h3>
            <ClaimList claims={b.baseCase} sources={s} />
          </div>
        </div>
        <span className="s-small s-muted">
          Scenarios are descriptions, not predictions or price targets.
        </span>
      </Card>
      <Card title="Sources and data freshness">
        <ol className="sources" style={{ margin: 0, paddingLeft: 20 }}>
          {s.map((src) => (
            <li key={src.id} data-testid="source">
              <strong>[{src.id}]</strong>{" "}
              <a href={src.url} target="_blank" rel="noreferrer noopener">
                {src.title}
              </a>{" "}
              <span className="s-small s-muted">
                · {src.publisher}
                {src.publishedAt
                  ? ` · published ${new Date(src.publishedAt).toLocaleDateString()}`
                  : ""}{" "}
                · retrieved {new Date(src.retrievedAt).toLocaleString()}
              </span>
            </li>
          ))}
        </ol>
        {b.openQuestions.length ? (
          <>
            <h3 style={{ margin: "8px 0 0", fontSize: 15 }}>Open questions and missing data</h3>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {b.openQuestions.map((q) => (
                <li key={q} className="s-small">
                  {q}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <span className="s-small s-muted">
          Data: SEC EDGAR · Finnhub (free tier). Prompt {row.promptVersion} · schema{" "}
          {row.schemaVersion}.
        </span>
      </Card>
      <FollowUps row={row} />
      <Feedback row={row} />
    </>
  );
}

function FollowUps({ row }: { row: BriefRow }) {
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const b = row.brief as unknown as Brief;
  const ask = useMutation({
    mutationFn: () =>
      api<Question>("POST", `/research/briefs/${row.id}/questions`, { question: q }),
    onSuccess: () => {
      setQ("");
      void qc.invalidateQueries({ queryKey: ["brief", row.id] });
    },
  });
  return (
    <Card title="Ask a follow-up question">
      <span className="s-small s-muted">
        Answered only from this brief's sources, with citations. If the sources don't cover it, we
        say so.
      </span>
      <form
        className="s-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (q.trim().length >= 3) ask.mutate();
        }}
      >
        <input
          className="s-input"
          style={{ flex: 1 }}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          maxLength={500}
          placeholder="e.g. How fast did revenue grow?"
          data-testid="question-input"
        />
        <Button variant="primary" type="submit" loading={ask.isPending} data-testid="ask">
          Ask
        </Button>
      </form>
      {ask.isError ? <Alert tone="negative">{errText(ask.error)}</Alert> : null}
      {row.questions.map((x) => (
        <div key={x.id} className="s-stack" style={{ gap: 4 }} data-testid="answer">
          <strong>{x.question}</strong>
          {x.insufficientSources ? (
            <span className="s-muted">The brief's sources don't answer this.</span>
          ) : (
            <ClaimList claims={x.claims as Brief["risks"]} sources={b.sources} />
          )}
          <span className="s-small s-muted">
            AI-generated by {x.model} via {x.provider === "groq" ? "Groq" : "Google Gemini"} · Not
            investment advice
          </span>
        </div>
      ))}
    </Card>
  );
}

function Feedback({ row }: { row: BriefRow }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const send = useMutation({
    mutationFn: (kind: "helpful" | "incorrect" | "outdated") =>
      api("POST", `/research/briefs/${row.id}/feedback`, { kind, note: note.trim() || undefined }),
    onSuccess: () => {
      setNote("");
      void qc.invalidateQueries({ queryKey: ["brief", row.id] });
    },
  });
  return (
    <Card title="Was this brief useful?">
      <input
        className="s-input"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={1000}
        placeholder="Optional note (what was wrong or out of date?)"
      />
      <div className="s-row">
        <Button onClick={() => send.mutate("helpful")} data-testid="feedback-helpful">
          Helpful
        </Button>
        <Button onClick={() => send.mutate("incorrect")}>Incorrect</Button>
        <Button onClick={() => send.mutate("outdated")}>Outdated</Button>
      </div>
      {row.myFeedback.length ? (
        <span className="s-small s-muted">
          You marked this: {row.myFeedback.map((f) => f.kind).join(", ")}. Thank you.
        </span>
      ) : null}
    </Card>
  );
}

function WatchlistAction({ entityId }: { entityId: string }) {
  const qc = useQueryClient();
  const lists = useQuery<z.infer<typeof watchlistsResponse>>({
    queryKey: ["watchlists"],
    queryFn: () => api("GET", "/watchlists"),
  });
  const [target, setTarget] = useState<string>("");
  const add = useMutation({
    mutationFn: () =>
      target
        ? api("POST", `/watchlists/${target}/items`, { entityId })
        : api("POST", "/watchlists/default/items", { entityId }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["watchlists"] }),
  });
  const onLists = (lists.data?.items ?? [])
    .filter((l) => l.items.some((i) => i.entityId === entityId))
    .map((l) => l.name);
  return (
    <Card title="Watchlist">
      <div className="s-row">
        <select
          className="s-select"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label="Watchlist"
        >
          <option value="">Default</option>
          {lists.data?.items
            .filter((l) => l.name !== "Default")
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </select>
        <Button onClick={() => add.mutate()} loading={add.isPending} data-testid="add-watchlist">
          Add to watchlist
        </Button>
        {onLists.length ? <Status tone="positive">On: {onLists.join(", ")}</Status> : null}
      </div>
      <span className="s-small s-muted">Adding a company never buys anything.</span>
    </Card>
  );
}
