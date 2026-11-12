"use client";
import { Avatar, Button, EmptyState, ErrorState, LoadingState, Mark } from "@suiem/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader } from "../../../components/AppShell";
import { api } from "../../../lib/api";
import { timeAgo } from "../../../lib/format";

interface Notification {
  id: string;
  kind: string;
  postId: string | null;
  commentId: string | null;
  thesisId: string | null;
  details: Record<string, unknown>;
  actor: { handle: string; displayName: string | null } | null;
  read: boolean;
  createdAt: string;
}

const TEXT: Record<string, string> = {
  new_follower: "started following you",
  comment: "commented on your post",
  reply: "replied to your comment",
  helpful: "found your post helpful",
  thesis_evaluated: "Your thesis reached its horizon and was evaluated",
  report_outcome: "A report you made was reviewed",
  appeal_outcome: "Your score appeal was reviewed",
  election_nominated: "You were nominated in this week's election",
  election_result: "An election you took part in has a final result",
};

function target(n: Notification): string {
  if (n.postId) return `/posts/${n.postId}`;
  if (n.thesisId) return `/theses/${n.thesisId}`;
  if (n.kind.startsWith("election")) {
    const slug = typeof n.details.slug === "string" ? n.details.slug : null;
    return slug ? `/elections/${slug}` : "/elections";
  }
  if (n.kind === "new_follower" && n.actor) return `/u/${n.actor.handle}`;
  return "/notifications";
}

export default function Notifications() {
  const qc = useQueryClient();
  const q = useQuery<{ unread: number; items: Notification[] }>({
    queryKey: ["notifications", "count"],
    queryFn: () => api("GET", "/notifications"),
  });
  const read = useMutation({
    mutationFn: () => api("POST", "/notifications/read", {}),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  return (
    <>
      <PageHeader
        title="Notifications"
        actions={
          q.data?.unread ? (
            <Button loading={read.isPending} onClick={() => read.mutate()}>
              Mark all as read
            </Button>
          ) : null
        }
      >
        Replies, followers, evaluations and elections. Never price alerts.
      </PageHeader>
      {q.isPending ? <LoadingState /> : null}
      {q.isError ? <ErrorState message={q.error.message} retry={() => void q.refetch()} /> : null}
      {q.data && q.data.items.length === 0 ? (
        <EmptyState title="You're all caught up">
          When someone follows you, replies or finds your research helpful, it shows up here.
        </EmptyState>
      ) : null}
      {q.data?.items.length ? (
        <section className="s-card" style={{ maxWidth: 760 }}>
          {q.data.items.map((n) => {
            const text = TEXT[n.kind] ?? n.kind.replace(/_/g, " ");
            const withActor = n.actor && /^[a-z]/.test(text);
            return (
              <Link key={n.id} href={target(n)} className="notif" data-unread={!n.read}>
                {n.actor ? <Avatar name={n.actor.displayName ?? n.actor.handle} /> : <Mark />}
                <div className="s-stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                  <span>
                    {withActor ? (
                      <>
                        <b style={{ fontWeight: 500 }}>{n.actor!.displayName ?? n.actor!.handle}</b>{" "}
                        {text}
                      </>
                    ) : (
                      text
                    )}
                  </span>
                  <span className="s-small s-faint">{timeAgo(n.createdAt)}</span>
                </div>
              </Link>
            );
          })}
        </section>
      ) : null}
    </>
  );
}
