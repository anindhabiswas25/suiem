"use client";
import type { compareResponse } from "@suiem/shared/schemas";
import { Alert, Button, Card, LoadingState } from "@suiem/ui";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type { z } from "zod";
import { PageHeader } from "../../../../components/AppShell";
import { EntitySearch, formatFigure } from "../../../../components/research/ui";
import { api, ApiRequestError } from "../../../../lib/api";

type Result = z.infer<typeof compareResponse>;

export default function Compare() {
  const [picked, setPicked] = useState<{ id: string; name: string }[]>([]);
  const run = useMutation({
    mutationFn: () =>
      api<Result>("POST", "/research/compare", { entityIds: picked.map((p) => p.id) }),
  });
  return (
    <>
      <PageHeader title="Compare companies">
        A side-by-side table built from SEC filings and Finnhub data. No AI, no opinions: every
        value links to its source.
      </PageHeader>
      <Card title="Pick 2–3 companies">
        <div className="s-row">
          {picked.map((p) => (
            <button
              key={p.id}
              type="button"
              className="s-chip"
              aria-pressed="true"
              onClick={() => setPicked(picked.filter((x) => x.id !== p.id))}
              title="Remove"
            >
              {p.name} ✕
            </button>
          ))}
        </div>
        {picked.length < 3 ? (
          <EntitySearch
            onPick={(id, name) =>
              !picked.some((p) => p.id === id) && setPicked([...picked, { id, name }])
            }
          />
        ) : null}
        <Button
          variant="primary"
          disabled={picked.length < 2}
          loading={run.isPending}
          onClick={() => run.mutate()}
          data-testid="compare"
        >
          Compare
        </Button>
        {run.isError ? (
          <Alert tone="negative">
            {run.error instanceof ApiRequestError ? run.error.message : "Comparison failed."}
          </Alert>
        ) : null}
      </Card>
      {run.isPending ? <LoadingState label="Fetching filings and market data…" /> : null}
      {run.data ? (
        <Card title="Comparison">
          <div className="table-wrap">
            <table className="figures">
              <thead>
                <tr>
                  <th>Metric</th>
                  {run.data.entities.map((e) => (
                    <th key={e.canonicalId}>
                      {e.name} {e.ticker ? <span className="s-muted">({e.ticker})</span> : null}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {run.data.rows.map((r) => (
                  <tr key={r.metric} data-testid="compare-row">
                    <td>{r.label}</td>
                    {r.cells.map((c, i) => (
                      <td key={i}>
                        {c.value === null ? (
                          <span className="s-muted">Not available</span>
                        ) : (
                          <div className="s-stack" style={{ gap: 2 }}>
                            <span className="num">
                              {formatFigure({
                                value: c.value,
                                unit: c.unit ?? "",
                                currency: c.currency,
                              })}
                            </span>
                            <span className="s-small s-muted">
                              {c.period} · as of {c.asOf} · {c.basis}
                              {c.formula ? ` · ${c.formula}` : ""}
                            </span>
                            {c.sourceUrl ? (
                              <a
                                className="cite"
                                href={c.sourceUrl}
                                target="_blank"
                                rel="noreferrer noopener"
                              >
                                {c.sourceLabel}
                              </a>
                            ) : null}
                          </div>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {run.data.entities.some((e) => e.dataNotes.length) ? (
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {run.data.entities.flatMap((e) =>
                e.dataNotes.map((n) => (
                  <li
                    key={`${e.canonicalId}${n}`}
                    className="s-small s-muted"
                  >{`${e.name}: ${n}`}</li>
                )),
              )}
            </ul>
          ) : null}
          <span className="s-small s-muted">
            Generated {new Date(run.data.generatedAt).toLocaleString()} · Data: SEC EDGAR · Finnhub
            (free tier) · Not investment advice.
          </span>
        </Card>
      ) : null}
    </>
  );
}
