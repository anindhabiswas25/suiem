"use client";
import type { briefListResponse } from "@suiem/shared/schemas";
import { Card, EmptyState, LoadingState, Status } from "@suiem/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { z } from "zod";
import { PageHeader, TabLinks } from "../../../components/AppShell";
import { EntitySearch } from "../../../components/research/ui";
import type { FeedPage } from "../../../components/social/FeedList";
import { api } from "../../../lib/api";
import { timeAgo } from "../../../lib/format";

function Recent() {
  const briefs = useQuery<z.infer<typeof briefListResponse>>({
    queryKey: ["briefs", "recent"],
    queryFn: () => api("GET", "/research/briefs?limit=20"),
  });
  if (briefs.isPending) return <LoadingState />;
  if (!briefs.data?.items.length)
    return (
      <EmptyState title="No research briefs yet">
        Search for a company above and request a brief. Every claim links to its source.
      </EmptyState>
    );
  return (
    <section className="s-card">
      <ul className="list">
        {briefs.data.items.map((b) => (
          <li key={b.id} data-testid="recent-brief" style={{ alignItems: "flex-start" }}>
            <div className="grow s-stack" style={{ gap: 4 }}>
              <div className="s-row" style={{ gap: 10 }}>
                <Link className="entity-name" href={`/research/${encodeURIComponent(b.entityId)}`}>
                  {b.entityName}
                </Link>
                <Status tone={b.dataFreshness === "fresh" ? "positive" : "warning"}>
                  {b.dataFreshness}
                </Status>
              </div>
              <span className="s-small s-muted">{b.summary}</span>
              <span className="s-small s-faint">
                {timeAgo(b.generatedAt)} · {b.model} via{" "}
                {b.provider === "groq" ? "Groq" : "Google Gemini"}
              </span>
            </div>
            <Link
              className="s-btn"
              data-size="sm"
              href={`/research/${encodeURIComponent(b.entityId)}`}
            >
              Open
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Explore() {
  const q = useQuery<FeedPage>({
    queryKey: ["explore-trending"],
    queryFn: () => api("GET", "/feed?tab=discover"),
  });
  const trending = q.data?.trending ?? [];
  return (
    <div className="s-stack" style={{ gap: 16 }}>
      <Card eyebrow="Talked about on Suiem this week">
        {q.isPending ? <LoadingState /> : null}
        {q.data && trending.length === 0 ? (
          <span className="s-small s-muted">
            Companies the community discusses will appear here.
          </span>
        ) : null}
        <div className="tile-grid">
          {trending.map((t) => (
            <Link key={t.id} href={`/research/${encodeURIComponent(t.id)}`} className="tile">
              <span className="entity-name">{t.name}</span>
              <span className="s-small s-faint s-num">{t.activity} posts and comments</span>
            </Link>
          ))}
        </div>
      </Card>
      <Card eyebrow="Community research" tone="subtle">
        <span className="s-muted">
          Theses and notes from investors you don&apos;t follow yet live in the Discover feed.
        </span>
        <Link className="s-btn" href="/feed?tab=discover" style={{ width: "fit-content" }}>
          Open Discover feed
        </Link>
      </Card>
    </div>
  );
}

function Research() {
  const sp = useSearchParams();
  const tab = sp.get("tab") === "explore" ? "explore" : "recent";
  return (
    <>
      <PageHeader
        title="Research"
        eyebrow="Sourced AI briefs"
        actions={
          <>
            <Link className="s-btn" href="/research/compare">
              Compare companies
            </Link>
            <Link className="s-btn" data-variant="primary" href="/theses/new">
              New thesis
            </Link>
          </>
        }
      >
        Cited research on the companies you choose. Every claim links to its source. Not investment
        advice.
      </PageHeader>
      <section className="s-card s-stack">
        <span className="s-eyebrow">Find a company</span>
        <EntitySearch />
      </section>
      <TabLinks
        label="Research"
        current={tab}
        tabs={[
          { key: "recent", label: "Your briefs", href: "/research" },
          { key: "explore", label: "Explore", href: "/research?tab=explore" },
        ]}
      />
      {tab === "recent" ? <Recent /> : <Explore />}
    </>
  );
}

export default function ResearchIndex() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Research />
    </Suspense>
  );
}
