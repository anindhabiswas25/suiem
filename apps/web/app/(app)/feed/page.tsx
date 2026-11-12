"use client";
import { Card, LoadingState } from "@suiem/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PageHeader, TabLinks } from "../../../components/AppShell";
import { CommunityTabs } from "../../../components/social/CommunityTabs";
import { FeedList, type FeedPage as FeedPageData } from "../../../components/social/FeedList";
import { Composer } from "../../../components/social/Post";
import { api } from "../../../lib/api";

type FeedPage = FeedPageData;

function Trending() {
  const feed = useInfiniteQuery<FeedPage>({
    queryKey: ["feed", "discover", null],
    initialPageParam: null as string | null,
    queryFn: () => api("GET", "/feed?tab=discover"),
    getNextPageParam: (p) => p.nextCursor,
  });
  const trending = feed.data?.pages[0]?.trending ?? [];
  return (
    <Card eyebrow="Talked about this week">
      {trending.length === 0 ? (
        <span className="s-small s-muted">Companies people discuss appear here.</span>
      ) : (
        <ul className="list">
          {trending.slice(0, 6).map((t) => (
            <li key={t.id}>
              <Link className="entity-name grow" href={`/research/${encodeURIComponent(t.id)}`}>
                {t.name}
              </Link>
              <span className="s-small s-faint s-num">{t.activity}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Feed() {
  const sp = useSearchParams();
  const tab = sp.get("tab") === "discover" ? "discover" : "following";
  return (
    <>
      <PageHeader title="Community" eyebrow="Research shared by investors">
        Theses, questions and notes from people you follow. Mark what helped you; that is how the
        community recognises good work.
      </PageHeader>
      <CommunityTabs current="feed" />
      <div className="cols">
        <div className="s-stack" style={{ gap: 14 }}>
          <Composer />
          <TabLinks
            label="Feed"
            current={tab}
            tabs={[
              { key: "following", label: "Following", href: "/feed" },
              { key: "discover", label: "Discover", href: "/feed?tab=discover" },
            ]}
          />
          <FeedList tab={tab} />
        </div>
        <aside className="rail">
          <Trending />
          <Card eyebrow="Write a thesis" tone="dark">
            <h2 style={{ margin: 0, fontSize: 26 }}>Reasoning first</h2>
            <p className="s-muted" style={{ margin: 0 }}>
              Write down why before you decide. Publish it and others can learn from it.
            </p>
            <Link
              className="s-btn"
              data-variant="primary"
              href="/theses/new"
              style={{ width: "fit-content" }}
            >
              New thesis
            </Link>
          </Card>
        </aside>
      </div>
    </>
  );
}

export default function FeedPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Feed />
    </Suspense>
  );
}
