"use client";
import type { PostView } from "@suiem/shared/social";
import { Avatar, Button, EmptyState, ErrorState, LoadingState } from "@suiem/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { PlainText } from "../../../../components/social/PlainText";
import { PostCard } from "../../../../components/social/Post";
import { api, ApiRequestError } from "../../../../lib/api";
import { timeAgo } from "../../../../lib/format";

interface Comment {
  id: string;
  parentId: string | null;
  body: string;
  createdAt: string;
  author: { id: string; handle: string; displayName: string | null; isDemo: boolean };
  counts: { helpful: number; notHelpful: number };
  viewer: { reaction: "helpful" | "not_helpful" | null; isAuthor: boolean };
}

function Reply({
  postId,
  parentId,
  onDone,
}: {
  postId: string;
  parentId?: string;
  onDone?: () => void;
}) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const send = useMutation({
    mutationFn: () =>
      api("POST", `/posts/${postId}/comments`, { body, ...(parentId ? { parentId } : {}) }),
    onSuccess: () => {
      setBody("");
      void qc.invalidateQueries({ queryKey: ["post", postId] });
      onDone?.();
    },
  });
  return (
    <form
      className="s-stack"
      style={{ gap: 8 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) send.mutate();
      }}
    >
      <label className="s-eyebrow" htmlFor={`reply-${parentId ?? "root"}`}>
        {parentId ? "Reply" : "Add a comment"}
      </label>
      <textarea
        id={`reply-${parentId ?? "root"}`}
        className="s-input"
        style={{ minHeight: 80 }}
        maxLength={4000}
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="s-row">
        <Button
          variant="primary"
          size="sm"
          type="submit"
          loading={send.isPending}
          disabled={!body.trim()}
        >
          {parentId ? "Reply" : "Comment"}
        </Button>
        {send.error ? (
          <span role="alert" className="s-small s-status" data-tone="negative">
            {send.error instanceof ApiRequestError ? send.error.message : "Couldn't send"}
          </span>
        ) : null}
      </div>
    </form>
  );
}

function CommentRow({ c, postId }: { c: Comment; postId: string }) {
  const qc = useQueryClient();
  const [replying, setReplying] = useState(false);
  const react = useMutation({
    mutationFn: () => api("POST", `/comments/${c.id}/reactions`, { kind: "helpful" }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["post", postId] }),
  });
  return (
    <div className="comment" data-reply={c.parentId ? "true" : undefined}>
      <Avatar name={c.author.displayName ?? c.author.handle} />
      <div className="s-stack" style={{ gap: 6, flex: 1, minWidth: 0 }}>
        <div className="s-row" style={{ gap: 8 }}>
          <Link className="post-author" href={`/u/${c.author.handle}`}>
            {c.author.displayName ?? c.author.handle}
          </Link>
          <span className="s-small s-faint">{timeAgo(c.createdAt)}</span>
        </div>
        <PlainText text={c.body} />
        <div className="post-actions">
          {!c.viewer.isAuthor ? (
            <Button
              size="sm"
              aria-pressed={c.viewer.reaction === "helpful"}
              onClick={() => react.mutate()}
              disabled={react.isPending || c.viewer.reaction === "helpful"}
            >
              Helpful · {c.counts.helpful}
            </Button>
          ) : (
            <span className="s-small s-faint">{c.counts.helpful} found this helpful</span>
          )}
          {!c.parentId ? (
            <Button size="sm" variant="ghost" onClick={() => setReplying(!replying)}>
              Reply
            </Button>
          ) : null}
        </div>
        {replying ? (
          <Reply postId={postId} parentId={c.id} onDone={() => setReplying(false)} />
        ) : null}
      </div>
    </div>
  );
}

export default function PostPage() {
  const { id } = useParams<{ id: string }>();
  const q = useQuery<{ post: PostView; comments: Comment[] }>({
    queryKey: ["post", id],
    queryFn: () => api("GET", `/posts/${id}`),
  });
  if (q.isPending) return <LoadingState label="Loading post…" />;
  if (q.isError) return <ErrorState message={q.error.message} retry={() => void q.refetch()} />;
  const top = q.data.comments.filter((c) => !c.parentId);
  return (
    <div className="s-stack" style={{ gap: 16, maxWidth: 760 }}>
      <Link href="/feed" className="s-small">
        ← Back to Community
      </Link>
      <PostCard post={q.data.post} linkToThread={false} />
      <section className="s-card s-stack">
        <span className="s-eyebrow">
          {q.data.comments.length} {q.data.comments.length === 1 ? "comment" : "comments"}
        </span>
        <Reply postId={id} />
        {top.length === 0 ? (
          <EmptyState title="No comments yet">Ask a question or add a source.</EmptyState>
        ) : (
          <div>
            {top.map((c) => (
              <div key={c.id}>
                <CommentRow c={c} postId={id} />
                {q.data.comments
                  .filter((r) => r.parentId === c.id)
                  .map((r) => (
                    <CommentRow key={r.id} c={r} postId={id} />
                  ))}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
