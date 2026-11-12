"use client";
import { ErrorState, LoadingState } from "@suiem/ui";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PageHeader } from "../../../../components/AppShell";
import { JoinButton, useCommunities } from "../../../../components/social/communities";
import { FeedList } from "../../../../components/social/FeedList";
import { Composer } from "../../../../components/social/Post";

export default function CommunityPage() {
  const { slug } = useParams<{ slug: string }>();
  const q = useCommunities();
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState message={q.error.message} retry={() => void q.refetch()} />;
  const c = q.data.items.find((x) => x.slug === slug);
  if (!c) return <ErrorState title="Community not found" />;
  return (
    <>
      <Link href="/communities" className="s-small">
        ← All communities
      </Link>
      <PageHeader title={c.name} eyebrow={`${c.members} members`} actions={<JoinButton c={c} />}>
        {c.description}
      </PageHeader>
      <div className="s-stack" style={{ gap: 14, maxWidth: 760 }}>
        {c.joined ? (
          <Composer community={c.slug} placeholder={`Share something with ${c.name}`} />
        ) : null}
        <FeedList tab="discover" community={c.slug} />
      </div>
    </>
  );
}
