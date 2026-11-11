"use client";
import type { entitySearchResponse, researchRequestItem } from "@suiem/shared/schemas";
import type { ResearchBriefV1 } from "@suiem/shared/research";
import { Button, Status } from "@suiem/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { api } from "../../lib/api";

export type Brief = ResearchBriefV1;
export type Claim = Brief["risks"][number];
export type Figure = Brief["financialHighlights"][number];
type Source = Brief["sources"][number];
export type RequestItem = z.infer<typeof researchRequestItem>;

const KIND_LABEL: Record<Claim["kind"], string> = {
  fact: "Fact",
  estimate: "Estimate",
  analysis: "Analysis",
  opinion: "Opinion",
};

/** Citation chips: each links to the cited source (PRD §6.5: every claim shows its sources). */
export function Citations({ ids, sources }: { ids: string[]; sources: Source[] }) {
  return (
    <span className="cite-row">
      {ids.map((id) => {
        const s = sources.find((x) => x.id === id);
        return s ? (
          <a
            key={id}
            className="cite"
            href={s.url}
            target="_blank"
            rel="noreferrer noopener"
            title={`${s.title} · ${s.publisher}`}
          >
            [{id}] {s.publisher}
          </a>
        ) : (
          <span key={id} className="cite" data-missing="true">
            [{id}]
          </span>
        );
      })}
    </span>
  );
}

export function ClaimList({
  claims,
  sources,
  empty = "Not covered by the sources.",
}: {
  claims: Claim[];
  sources: Source[];
  empty?: string;
}) {
  if (claims.length === 0) return <span className="s-muted s-small">{empty}</span>;
  return (
    <ul className="claims">
      {claims.map((c) => (
        <li key={c.id} data-testid="claim">
          <span className="kind" data-kind={c.kind}>
            {KIND_LABEL[c.kind]}
          </span>{" "}
          {c.text} <Citations ids={c.sourceIds} sources={sources} />
        </li>
      ))}
    </ul>
  );
}

/** Formats a decimal string for display without floats (adds thousands separators). */
export function formatDecimal(value: string): string {
  const [whole, frac] = value.split(".");
  const neg = whole!.startsWith("-");
  const digits = neg ? whole!.slice(1) : whole!;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "-" : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

export function formatFigure(f: { value: string; unit: string; currency: string | null }): string {
  if (f.unit === "%") return `${formatDecimal(f.value)}%`;
  if (f.unit === "x") return `${formatDecimal(f.value)}×`;
  if (f.unit === "USD") return `USD ${formatDecimal(f.value)}`;
  return `${formatDecimal(f.value)} ${f.unit}`;
}

/** Every figure shows currency, unit, period, source, as-of date, kind and formula (PRD §6.5). */
export function FigureTable({ figures, sources }: { figures: Figure[]; sources: Source[] }) {
  if (figures.length === 0)
    return <span className="s-muted s-small">No figures available from the sources.</span>;
  return (
    <div className="table-wrap">
      <table className="figures">
        <thead>
          <tr>
            <th>Metric</th>
            <th>Value</th>
            <th>Period</th>
            <th>As of</th>
            <th>Kind</th>
            <th>Formula</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody>
          {figures.map((f) => (
            <tr key={f.id} data-testid="figure">
              <td>{f.text.split(/ was | grew | were |: /)[0]}</td>
              <td
                className="num"
                title={`${f.value} ${f.unit}${f.currency ? ` (${f.currency})` : ""}`}
              >
                {formatFigure(f)}
              </td>
              <td>{f.period}</td>
              <td>{f.asOf}</td>
              <td>{f.basis}</td>
              <td className="s-small">{f.formula ?? "—"}</td>
              <td>
                <Citations ids={f.sourceIds} sources={sources} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Search the entity registry (also used by Discover and Compare). */
export function EntitySearch({
  onPick,
  placeholder = "Search a company or ticker (e.g. NVDA)",
}: {
  onPick?: (id: string, name: string) => void;
  placeholder?: string;
}) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const r = useQuery<z.infer<typeof entitySearchResponse>>({
    queryKey: ["entity-search", debounced],
    queryFn: () => api("GET", `/entities/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length > 0,
  });
  return (
    <div className="s-stack" style={{ gap: 6 }}>
      <input
        className="s-input"
        aria-label="Search companies"
        placeholder={placeholder}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        data-testid="entity-search"
      />
      {debounced && r.data ? (
        <ul className="search-results">
          {r.data.items.length === 0 ? (
            <li className="s-muted s-small">No matches in the Suiem registry.</li>
          ) : null}
          {r.data.items.map((e) => (
            <li key={e.canonicalId}>
              {onPick ? (
                <button
                  type="button"
                  className="linklike"
                  onClick={() => (onPick(e.canonicalId, e.name), setQ(""))}
                >
                  {e.name} <span className="s-muted">{e.tickers.join(" · ")}</span>
                </button>
              ) : (
                <Link href={`/research/${encodeURIComponent(e.canonicalId)}`}>
                  {e.name} <span className="s-muted">{e.tickers.join(" · ")}</span>
                </Link>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function RequestStatus({
  r,
  onRetry,
  retrying,
}: {
  r: RequestItem;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  const when = new Date(r.createdAt).toLocaleString();
  const from =
    r.source === "web"
      ? "from the web app"
      : r.sourceUrl
        ? `from ${new URL(r.sourceUrl).hostname}`
        : "from the extension";
  return (
    <div className="s-row" data-testid="request-status" data-status={r.status}>
      {r.status === "queued" ? <Status tone="warning">Queued</Status> : null}
      {r.status === "processing" ? <Status tone="warning">Researching…</Status> : null}
      {r.status === "completed" ? <Status tone="positive">Ready</Status> : null}
      {r.status === "failed" ? <Status tone="negative">Failed</Status> : null}
      <span className="s-small s-muted">
        {when} · {from}
        {r.hasExcerpt ? " · with your selected text" : ""}
      </span>
      {r.status === "failed" ? (
        <>
          <span className="s-small" data-testid="failure-reason">
            {r.failureReason}
          </span>
          {onRetry && !/limit reached/i.test(r.failureReason ?? "") ? (
            <Button onClick={onRetry} loading={retrying}>
              Retry
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function AiLabel({
  model,
  provider,
  generatedAt,
  cached,
}: {
  model: string;
  provider: string;
  generatedAt: string;
  cached?: boolean;
}) {
  const p = provider === "groq" ? "Groq" : provider === "gemini" ? "Google Gemini" : provider;
  return (
    <span className="s-badge" data-tone="neutral" data-testid="ai-label">
      AI-generated by {model} via {p}, {new Date(generatedAt).toLocaleString()}
      {cached ? " (shared public-data brief)" : ""}
    </span>
  );
}
