"use client";
import { EmptyState, ErrorState, LoadingState } from "@suiem/ui";
import Link from "next/link";
import { PageHeader } from "../../../components/AppShell";
import { CommunityTabs } from "../../../components/social/CommunityTabs";
import { JoinButton, useCommunities } from "../../../components/social/communities";

export default function Communities() {
  const q = useCommunities();
  return (
    <>
      <PageHeader title="Communities" eyebrow="Community">
        Rooms by sector. Joining adds their posts to your feed. It never changes your score.
      </PageHeader>
      <CommunityTabs current="communities" />
      {q.isPending ? <LoadingState /> : null}
      {q.isError ? <ErrorState message={q.error.message} retry={() => void q.refetch()} /> : null}
      {q.data?.items.length === 0 ? <EmptyState title="No communities yet" /> : null}
      <div className="grid3">
        {q.data?.items.map((c) => (
          <article key={c.slug} className="s-card s-stack" style={{ gap: 14 }}>
            <div className="s-row" style={{ justifyContent: "space-between" }}>
              <span className="s-eyebrow s-num">{c.members} members</span>
              <JoinButton c={c} />
            </div>
            <Link href={`/communities/${c.slug}`} className="entity-name" style={{ fontSize: 30 }}>
              {c.name}
            </Link>
            <p className="s-muted" style={{ margin: 0 }}>
              {c.description}
            </p>
            {c.sectors.length ? (
              <div className="s-row" style={{ gap: 6 }}>
                {c.sectors.slice(0, 4).map((s) => (
                  <span key={s} className="s-badge">
                    {s.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </>
  );
}
