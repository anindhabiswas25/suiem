"use client";
import { Card, EmptyState, ErrorState, LoadingState } from "@suiem/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PageHeader, TabLinks } from "../../../components/AppShell";
import {
  candidateName,
  isOpen,
  type Election,
  type VoteClaim,
} from "../../../components/elections/types";
import { api } from "../../../lib/api";
import { timeLeft } from "../../../lib/format";

function ElectionCard({ e }: { e: Election }) {
  const open = isOpen(e);
  const sorted = [...e.candidates].sort((a, b) => Number(BigInt(b.votes) - BigInt(a.votes)));
  const leader = sorted[0];
  const total = Number(e.totalVotes) || 0;
  const left = timeLeft(e.endsAt);
  return (
    <Link
      href={`/elections/${e.slug}`}
      className="s-card s-stack"
      data-tone={open ? "dark" : undefined}
      style={{ textDecoration: "none", color: "inherit", gap: 14 }}
      data-testid="election-card"
    >
      <div className="s-row" style={{ justifyContent: "space-between" }}>
        <span className="s-eyebrow">{e.categoryTitle}</span>
        <span
          className="s-badge"
          data-tone={open ? "real" : e.result === "final" ? "ink" : undefined}
        >
          {open ? "Voting open" : e.result === "final" ? "Final result" : e.status}
        </span>
      </div>
      <h2 style={{ margin: 0, fontSize: 32 }}>{e.title}</h2>
      <div className="s-row s-small s-muted" style={{ gap: 16 }}>
        <span>{e.candidates.length} candidates</span>
        <span className="s-num">{e.totalVotes} $WIF burned</span>
        <span>{open && left ? `Closes in ${left}` : new Date(e.endsAt).toLocaleDateString()}</span>
      </div>
      {leader && total ? (
        <div className="s-stack" style={{ gap: 6 }}>
          <span className="s-small">
            {e.result === "final" ? "Winner" : "Leading"}:{" "}
            <b style={{ fontWeight: 500 }}>{candidateName(leader)}</b>
          </span>
          <div className="bar">
            <i
              style={{
                width: `${(Number(leader.votes) / total) * 100}%`,
                background: open ? "#fff" : undefined,
              }}
            />
          </div>
        </div>
      ) : null}
      {e.labels.length ? (
        <div className="s-row" style={{ gap: 6 }}>
          {e.labels.map((l) => (
            <span key={l} className="s-badge">
              {l}
            </span>
          ))}
        </div>
      ) : null}
    </Link>
  );
}

function MyVotes() {
  const q = useQuery<{ items: VoteClaim[] }>({
    queryKey: ["my-votes"],
    queryFn: () => api("GET", "/me/votes"),
  });
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState message={q.error.message} retry={() => void q.refetch()} />;
  if (!q.data.items.length)
    return (
      <EmptyState title="You haven't voted yet">
        Votes you cast from Suiem appear here with their transaction links.
      </EmptyState>
    );
  return (
    <section className="s-card">
      <ul className="list">
        {q.data.items.map((v) => (
          <li key={v.id}>
            <div className="grow">
              <Link href={`/elections/${v.election}`} className="post-author">
                {v.election}
              </Link>
              <div className="s-small s-faint">
                Candidate #{v.candidateId} · {new Date(v.boundAt).toLocaleString()}
              </div>
            </div>
            <span className="s-serif s-num" style={{ fontSize: 24 }}>
              {v.burned}
            </span>
            <a href={v.explorerUrl} target="_blank" rel="noreferrer noopener" className="s-small">
              {v.indexed ? (v.finality ?? "indexed") : "pending"} ↗
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Elections() {
  const sp = useSearchParams();
  const tab =
    (["current", "results", "mine", "campaigns"] as const).find((t) => t === sp.get("tab")) ??
    "current";
  const q = useQuery<{ items: Election[] }>({
    queryKey: ["elections"],
    queryFn: () => api("GET", "/elections"),
    refetchInterval: 30_000,
  });
  const items = q.data?.items ?? [];
  const current = items.filter((e) => e.status === "open" || e.status === "scheduled");
  const results = items.filter(
    (e) => e.status === "closed" || e.status === "finalized" || e.status === "cancelled",
  );
  const list = tab === "current" ? current : results;
  return (
    <>
      <PageHeader title="Elections" network="mainnet" eyebrow="$WIF burn-to-vote">
        Each week the community recognises helpful contributors. Voting burns real $WIF on Robinhood
        Chain mainnet, every vote is on chain, and votes never change anyone&apos;s Suiem Score.
      </PageHeader>
      <TabLinks
        label="Elections"
        current={tab}
        tabs={[
          { key: "current", label: "This week", href: "/elections" },
          { key: "results", label: "Results", href: "/elections?tab=results" },
          { key: "mine", label: "My votes", href: "/elections?tab=mine" },
          { key: "campaigns", label: "Campaigns", href: "/elections?tab=campaigns" },
        ]}
      />
      {tab === "mine" ? <MyVotes /> : null}
      {tab === "campaigns" ? (
        <EmptyState title="No campaigns yet">
          Sponsor-funded research campaigns will appear here, prefunded on chain before they open.
        </EmptyState>
      ) : null}
      {tab === "current" || tab === "results" ? (
        <>
          {q.isPending ? <LoadingState label="Loading elections…" /> : null}
          {q.isError ? (
            <ErrorState message={q.error.message} retry={() => void q.refetch()} />
          ) : null}
          {q.data && list.length === 0 ? (
            <EmptyState
              title={tab === "current" ? "No election is open right now" : "No results yet"}
              action={
                tab === "current" && results.length ? (
                  <Link className="s-btn" href="/elections?tab=results">
                    See past results
                  </Link>
                ) : undefined
              }
            >
              {tab === "current"
                ? "A new round opens each week with candidates from the leaderboards."
                : "Finished elections and their winners appear here."}
            </EmptyState>
          ) : null}
          <div className="grid2">
            {list.map((e) => (
              <ElectionCard key={e.slug} e={e} />
            ))}
          </div>
        </>
      ) : null}
      <Card eyebrow="How it works" tone="subtle">
        <div className="grid3">
          <div className="s-stack" style={{ gap: 4 }}>
            <h3 style={{ margin: 0, fontSize: 22 }}>Candidates come from evidence</h3>
            <span className="s-small s-muted">
              The top of the weekly leaderboards are nominated.
            </span>
          </div>
          <div className="s-stack" style={{ gap: 4 }}>
            <h3 style={{ margin: 0, fontSize: 22 }}>1 vote burns 1 $WIF</h3>
            <span className="s-small s-muted">
              You approve the exact amount, never unlimited. Burned tokens are gone for good.
            </span>
          </div>
          <div className="s-stack" style={{ gap: 4 }}>
            <h3 style={{ margin: 0, fontSize: 22 }}>Counted from the chain</h3>
            <span className="s-small s-muted">
              Tallies come only from indexed on-chain events, with the block they are as of.
            </span>
          </div>
        </div>
      </Card>
    </>
  );
}

export default function ElectionsPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Elections />
    </Suspense>
  );
}
