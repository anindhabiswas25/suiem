"use client";
import type { briefListResponse } from "@suiem/shared/schemas";
import { Card, EmptyState, LoadingState, Status } from "@suiem/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { z } from "zod";
import { PageHeader } from "../../../components/AppShell";
import { EntitySearch } from "../../../components/research/ui";
import { api } from "../../../lib/api";

export default function ResearchIndex() {
  const briefs = useQuery<z.infer<typeof briefListResponse>>({
    queryKey: ["briefs", "recent"],
    queryFn: () => api("GET", "/research/briefs?limit=20"),
  });
  return (
    <>
      <PageHeader title="Research">
        Sourced, cited AI research briefs on companies you choose. Not investment advice.
      </PageHeader>
      <Card title="Find a company">
        <EntitySearch />
        <Link href="/research/compare">Compare 2–3 companies side by side</Link>
      </Card>
      <Card title="Your recent briefs">
        {briefs.isPending ? <LoadingState /> : null}
        {briefs.data?.items.length === 0 ? (
          <EmptyState title="No research briefs yet">
            Search for a company above and request a brief.
          </EmptyState>
        ) : null}
        <ul className="s-stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {briefs.data?.items.map((b) => (
            <li key={b.id} className="s-stack" style={{ gap: 2 }} data-testid="recent-brief">
              <div className="s-row">
                <Link href={`/research/${encodeURIComponent(b.entityId)}`}>
                  <strong>{b.entityName}</strong>
                </Link>
                <Status tone={b.dataFreshness === "fresh" ? "positive" : "warning"}>
                  {b.dataFreshness}
                </Status>
                <span className="s-small s-muted">
                  {new Date(b.generatedAt).toLocaleString()} · {b.model} via{" "}
                  {b.provider === "groq" ? "Groq" : "Google Gemini"}
                </span>
              </div>
              <span className="s-small">{b.summary}</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
