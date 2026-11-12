"use client";
import type { PostView } from "@suiem/shared/social";
import { Button, EmptyState, ErrorState, LoadingState } from "@suiem/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import { api } from "../../lib/api";
import { PostCard } from "./Post";

export interface FeedPage {
  items: PostView[];
  nextCursor: string | null;
  trending: { id: string; name: string; activity: number }[];
}

export function FeedList({
  tab,
  community,
}: {
  tab: "following" | "discover";
  community?: string;
}) {
  const feed = useInfiniteQuery<FeedPage>({
    queryKey: ["feed", tab, community ?? null],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const q = new URLSearchParams({ tab });
      if (pageParam) q.set("cursor", pageParam as string);
      if (community) q.set("community", community);
      return api("GET", `/feed?${q}`);
    },
    getNextPageParam: (p) => p.nextCursor,
  });
  if (feed.isPending) return <LoadingState label="Loading posts…" />;
  if (feed.isError)
    return <ErrorState message={feed.error.message} retry={() => void feed.refetch()} />;
  const items = feed.data.pages.flatMap((p) => p.items);
  if (!items.length)
    return tab === "following" ? (
      <EmptyState
        title="Your feed is quiet"
        action={
          <Link className="s-btn" data-variant="primary" href="/feed?tab=discover">
            Discover people
          </Link>
        }
      >
        Follow people whose research you trust, or join a community, and their posts appear here.
      </EmptyState>
    ) : (
      <EmptyState title="No posts yet">Be the first to share something you researched.</EmptyState>
    );
  return (
    <div className="timeline">
      {items.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      {feed.hasNextPage ? (
        <div className="timeline-more">
          <Button onClick={() => void feed.fetchNextPage()} loading={feed.isFetchingNextPage}>
            Show more posts
          </Button>
        </div>
      ) : null}
    </div>
  );
}
