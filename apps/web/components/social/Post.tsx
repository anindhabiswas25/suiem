"use client";
import type { PostKind, PostView, Visibility } from "@suiem/shared/social";
import { Avatar, Button } from "@suiem/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { api, ApiRequestError } from "../../lib/api";
import { timeAgo } from "../../lib/format";
import { useMe } from "../../lib/session";
import { PlainText } from "./PlainText";

export const KIND_LABEL: Record<PostKind, string> = {
  research_brief: "Research brief",
  thesis: "Thesis",
  discussion: "Discussion",
  portfolio_snapshot: "Portfolio snapshot",
  learning_note: "Learning note",
  question: "Question",
};

export function AuthorLine({
  author,
  createdAt,
  extra,
}: {
  author: { handle: string; displayName: string | null; isDemo: boolean };
  createdAt: string;
  extra?: React.ReactNode;
}) {
  return (
    <div className="post-head">
      <Avatar name={author.displayName ?? author.handle} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="s-row" style={{ gap: 8 }}>
          <Link className="post-author" href={`/u/${author.handle}`}>
            {author.displayName ?? author.handle}
          </Link>
          <span className="s-small s-faint">
            @{author.handle} · {timeAgo(createdAt)}
          </span>
        </div>
      </div>
      {extra}
    </div>
  );
}

const ICON_PATHS = {
  comment:
    "M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 4v-4h0A2.5 2.5 0 0 1 4 13.5z",
  helpful: "M7 11v9H4v-9zm0 0 4-8a2 2 0 0 1 2 2v4h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 20H7",
  notHelpful: "M17 13V4h3v9zm0 0-4 8a2 2 0 0 1-2-2v-4H5.5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.7 4H17",
  save: "M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.5L5 21V4.5a1 1 0 0 1 1-1z",
} as const;

function Icon({ name }: { name: keyof typeof ICON_PATHS }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

/** One post in the feed, laid out like a timeline row. User text is rendered only through PlainText. */
export function PostCard({
  post,
  linkToThread = true,
}: {
  post: PostView;
  linkToThread?: boolean;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["feed"] });
    void qc.invalidateQueries({ queryKey: ["post", post.id] });
    void qc.invalidateQueries({ queryKey: ["bookmarks"] });
    void qc.invalidateQueries({ queryKey: ["profile-research"] });
  };
  const act = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: refresh,
    onError: (e) => setError(e instanceof ApiRequestError ? e.message : "That didn't work"),
  });
  const react = (kind: "helpful" | "not_helpful") =>
    act.mutate(() =>
      post.viewer.reaction === kind
        ? api("DELETE", `/posts/${post.id}/reactions/${kind}`)
        : api("POST", `/posts/${post.id}/reactions`, { kind }),
    );
  const labels = [
    post.labels.sourced ? "Sourced" : null,
    post.labels.aiAssisted ? "AI-assisted" : null,
    post.labels.simulatedTestnet ? "Testnet · no value" : null,
    post.labels.sponsored ? "Sponsored" : null,
  ].filter(Boolean) as string[];
  const a = post.author;
  const name = a.displayName ?? a.handle;

  return (
    <article className="post" data-testid="post">
      <Link href={`/u/${a.handle}`} className="post-avatar" tabIndex={-1} aria-hidden="true">
        <Avatar name={name} />
      </Link>
      <div className="post-main">
        <div className="post-meta">
          <Link className="post-author" href={`/u/${a.handle}`}>
            {name}
          </Link>
          <span className="post-sub">
            @{a.handle} ·{" "}
            {linkToThread ? (
              <Link href={`/posts/${post.id}`} className="post-time">
                {timeAgo(post.createdAt)}
              </Link>
            ) : (
              timeAgo(post.createdAt)
            )}
          </span>
          <span className="post-kind">{KIND_LABEL[post.kind]}</span>
        </div>
        <PlainText text={post.body} className="post-body" />
        {post.entity || labels.length ? (
          <div className="s-row" style={{ gap: 6 }}>
            {post.entity ? (
              <Link
                className="post-entity"
                href={`/research/${encodeURIComponent(post.entity.id)}`}
              >
                {post.entity.name}
                <span aria-hidden="true">→</span>
              </Link>
            ) : null}
            {labels.map((l) => (
              <span
                key={l}
                className="s-badge"
                data-tone={l.startsWith("Testnet") ? "test" : undefined}
              >
                {l}
              </span>
            ))}
          </div>
        ) : null}
        <div className="post-actions">
          {linkToThread ? (
            <Link className="post-act" href={`/posts/${post.id}`}>
              <Icon name="comment" />
              {post.counts.comments
                ? `${post.counts.comments} comment${post.counts.comments === 1 ? "" : "s"}`
                : "Comment"}
            </Link>
          ) : null}
          {post.viewer.isAuthor ? (
            <span className="post-act" data-static="true">
              <Icon name="helpful" />
              {post.counts.helpful} found this helpful
            </span>
          ) : (
            <>
              <button
                type="button"
                className="post-act"
                data-tone="positive"
                aria-pressed={post.viewer.reaction === "helpful"}
                onClick={() => react("helpful")}
                disabled={act.isPending}
              >
                <Icon name="helpful" />
                Helpful · {post.counts.helpful}
              </button>
              <button
                type="button"
                className="post-act"
                data-tone="negative"
                aria-pressed={post.viewer.reaction === "not_helpful"}
                onClick={() => react("not_helpful")}
                disabled={act.isPending}
              >
                <Icon name="notHelpful" />
                Not helpful
              </button>
            </>
          )}
          <button
            type="button"
            className="post-act"
            aria-pressed={post.viewer.bookmarked}
            onClick={() =>
              act.mutate(() =>
                api(post.viewer.bookmarked ? "DELETE" : "POST", `/posts/${post.id}/bookmark`),
              )
            }
            disabled={act.isPending}
          >
            <Icon name="save" />
            {post.viewer.bookmarked ? "Saved" : "Save"}
          </button>
          <span className="post-vis">
            {post.visibility === "public"
              ? "Public"
              : post.visibility === "followers"
                ? "Followers"
                : "Only you"}
          </span>
        </div>
        {error ? (
          <span role="alert" className="s-small s-status" data-tone="negative">
            {error}
          </span>
        ) : null}
      </div>
    </article>
  );
}

const COMPOSER_KINDS: PostKind[] = ["discussion", "question", "learning_note"];

/** Post composer. Nothing is public by default: the author picks the audience every time. */
export function Composer({
  community,
  placeholder = "Share what you're researching. Cite your sources.",
}: {
  community?: string;
  placeholder?: string;
}) {
  const qc = useQueryClient();
  const me = useMe();
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<PostKind>("discussion");
  const [visibility, setVisibility] = useState<Visibility>("followers");
  const post = useMutation({
    mutationFn: () =>
      api("POST", "/posts", {
        kind,
        body,
        visibility,
        ...(community ? { community } : {}),
      }),
    onSuccess: () => {
      setBody("");
      void qc.invalidateQueries({ queryKey: ["feed"] });
    },
  });
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        if (body.trim()) post.mutate();
      }}
    >
      <div className="composer-top">
        <Avatar name={me.data?.displayName ?? me.data?.handle ?? "?"} />
        <div className="s-stack" style={{ gap: 4, flex: 1, minWidth: 0 }}>
          <label htmlFor="composer-body" className="s-sr-only">
            New post
          </label>
          <textarea
            id="composer-body"
            className="s-input"
            value={body}
            maxLength={10_000}
            placeholder={placeholder}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>
      </div>
      <div className="composer-bar">
        <div className="s-row" style={{ gap: 6 }}>
          {COMPOSER_KINDS.map((k) => (
            <button
              type="button"
              key={k}
              className="s-chip"
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
            >
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        <div className="s-row" style={{ gap: 8 }}>
          <select
            className="s-select"
            style={{ width: "auto", minHeight: 40 }}
            aria-label="Who can see this"
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as Visibility)}
          >
            <option value="followers">Followers</option>
            <option value="public">Public</option>
            <option value="private">Only me</option>
          </select>
          <Button variant="primary" type="submit" loading={post.isPending} disabled={!body.trim()}>
            Post
          </Button>
        </div>
      </div>
      {post.error ? (
        <span role="alert" className="s-small s-status" data-tone="negative">
          {post.error instanceof ApiRequestError ? post.error.message : "Couldn't post"}
        </span>
      ) : null}
    </form>
  );
}
