"use client";
import type { PostView } from "@suiem/shared/social";
import { Avatar, Button, Card, EmptyState, ErrorState, LoadingState } from "@suiem/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { PlainText } from "../../../../components/social/PlainText";
import { PostCard } from "../../../../components/social/Post";
import { api, ApiRequestError } from "../../../../lib/api";
import { timeAgo } from "../../../../lib/format";

interface Component {
  key: string;
  label: string;
  weight: number;
  status: "scored" | "insufficient_data";
  score: string | null;
}
interface Reputation {
  maturity: "building" | "ranked";
  badge: string | null;
  suiemScore: string | null;
  investorScore: string | null;
  contributionScore: string | null;
  investor: Component[];
  contribution: Component[];
  progress: Record<
    "decisions" | "activeDays" | "historyDays" | "raters",
    { have: number; need: number }
  >;
  disclaimer: string;
  whatChanged: { label?: string; text?: string }[] | string[];
}
interface Profile {
  id: string;
  handle: string;
  displayName: string | null;
  joinedAt: string;
  isDemo: boolean;
  badges: string[];
  isMe: boolean;
  relation: { following: boolean; followedBy: boolean; muting: boolean; blocking: boolean };
  blocked?: boolean;
  bio: string | null;
  achievements?: { kind: string; title: string; awardedAt: string | null; note: string }[];
  followers?: { followers: number; following: number } | null;
  theses?:
    | {
        id: string;
        title: string;
        direction: string;
        horizonDays: number;
        entityId: string;
        entityName: string;
        publishedAt: string | null;
      }[]
    | null;
  reputation?: Reputation | null;
}

const PROGRESS_LABEL = {
  decisions: "Decisions",
  activeDays: "Active days",
  historyDays: "Days of history",
  raters: "People who rated your work",
} as const;

function ScoreCard({ r }: { r: Reputation }) {
  if (r.maturity !== "ranked")
    return (
      <Card eyebrow="Suiem Score">
        <h2 style={{ margin: 0, fontSize: 28 }}>Building track record</h2>
        <span className="s-small s-muted">
          A score appears once there is enough evidence. Nothing missing is ever counted as success.
        </span>
        <div className="s-stack" style={{ gap: 10 }}>
          {(Object.keys(PROGRESS_LABEL) as (keyof typeof PROGRESS_LABEL)[]).map((k) => {
            const p = r.progress[k];
            return (
              <div key={k} className="s-stack" style={{ gap: 6 }}>
                <div className="s-row s-small" style={{ justifyContent: "space-between" }}>
                  <span>{PROGRESS_LABEL[k]}</span>
                  <span className="s-num s-faint">
                    {Math.min(p.have, p.need)} / {p.need}
                  </span>
                </div>
                <div className="bar">
                  <i style={{ width: `${Math.min(100, (p.have / Math.max(1, p.need)) * 100)}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    );
  return (
    <Card eyebrow="Suiem Score">
      <div className="s-row" style={{ alignItems: "baseline", gap: 10 }}>
        <span className="big-num">{Number(r.suiemScore ?? 0).toFixed(1)}</span>
        {r.badge ? <span className="s-badge">{r.badge}</span> : null}
      </div>
      {[
        { label: "Investor process", v: r.investorScore },
        { label: "Community contribution", v: r.contributionScore },
      ].map((x) => (
        <div key={x.label} className="s-stack" style={{ gap: 6 }}>
          <div className="s-row s-small" style={{ justifyContent: "space-between" }}>
            <span>{x.label} · 50%</span>
            <span className="s-num">{x.v ? Number(x.v).toFixed(1) : "–"}</span>
          </div>
          <div className="bar">
            <i style={{ width: `${Math.min(100, Number(x.v ?? 0))}%` }} />
          </div>
        </div>
      ))}
      <span className="s-small s-faint">{r.disclaimer}</span>
    </Card>
  );
}

export default function ProfilePage() {
  const { handle } = useParams<{ handle: string }>();
  const qc = useQueryClient();
  const p = useQuery<Profile>({
    queryKey: ["profile", handle],
    queryFn: () => api("GET", `/profiles/${handle}`),
  });
  const research = useQuery<{
    posts: PostView[];
    activity: { entityId: string; name: string; lastResearchedAt: string }[] | null;
  }>({
    queryKey: ["profile-research", handle],
    queryFn: () => api("GET", `/profiles/${handle}/research`),
    enabled: !!p.data && !p.data.blocked,
  });
  const follow = useMutation({
    mutationFn: () =>
      api(p.data!.relation.following ? "DELETE" : "POST", `/users/${p.data!.id}/follow`),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["profile", handle] }),
  });
  if (p.isPending) return <LoadingState label="Loading profile…" />;
  if (p.isError)
    return (
      <ErrorState
        title={
          p.error instanceof ApiRequestError && p.error.status === 404
            ? "No such profile"
            : undefined
        }
        message={p.error.message}
      />
    );
  const u = p.data;
  const name = u.displayName ?? u.handle;
  return (
    <>
      <section className="s-card" style={{ padding: 32 }}>
        <div className="s-row" style={{ gap: 20, alignItems: "flex-start" }}>
          <Avatar name={name} size="lg" />
          <div className="s-stack" style={{ gap: 8, flex: 1, minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: "clamp(40px, 6vw, 60px)" }}>{name}</h1>
            <div className="s-row" style={{ gap: 8 }}>
              <span className="s-muted">@{u.handle}</span>
              <span className="s-faint s-small">
                · joined{" "}
                {new Date(u.joinedAt).toLocaleDateString(undefined, {
                  month: "long",
                  year: "numeric",
                })}
              </span>
              {u.relation.followedBy ? <span className="s-badge">Follows you</span> : null}
              {u.badges.map((b) => (
                <span key={b} className="s-badge">
                  {b}
                </span>
              ))}
            </div>
            {u.bio ? <PlainText text={u.bio} /> : null}
            {u.followers ? (
              <div className="s-row s-small" style={{ gap: 18 }}>
                <span>
                  <b className="s-num">{u.followers.followers}</b>{" "}
                  <span className="s-muted">followers</span>
                </span>
                <span>
                  <b className="s-num">{u.followers.following}</b>{" "}
                  <span className="s-muted">following</span>
                </span>
              </div>
            ) : null}
          </div>
          <div className="s-row">
            {u.isMe ? (
              <Link className="s-btn" href="/settings#profile">
                Edit profile
              </Link>
            ) : u.blocked ? null : (
              <Button
                variant={u.relation.following ? "secondary" : "primary"}
                loading={follow.isPending}
                onClick={() => follow.mutate()}
              >
                {u.relation.following ? "Following" : "Follow"}
              </Button>
            )}
          </div>
        </div>
        {follow.error ? (
          <span role="alert" className="s-small s-status" data-tone="negative">
            {follow.error.message}
          </span>
        ) : null}
      </section>

      {u.blocked ? (
        <EmptyState title="You blocked this account">
          Unblock them in Settings to see their profile.
        </EmptyState>
      ) : (
        <div className="cols">
          <div className="s-stack" style={{ gap: 16 }}>
            <div className="section-title">
              <h2>Theses</h2>
            </div>
            {u.theses === null || u.theses === undefined ? (
              <EmptyState title="Theses are private" />
            ) : u.theses.length === 0 ? (
              <EmptyState title="No published theses yet" />
            ) : (
              <div className="tile-grid">
                {u.theses.map((t) => (
                  <Link
                    key={t.id}
                    href={`/theses/${t.id}`}
                    className="tile"
                    style={{ background: "var(--surface)" }}
                  >
                    <span className="s-eyebrow">
                      {t.direction} · {t.horizonDays} days
                    </span>
                    <span className="entity-name">{t.entityName}</span>
                    <span className="s-small s-muted">{t.title}</span>
                  </Link>
                ))}
              </div>
            )}
            <div className="section-title">
              <h2>Posts</h2>
            </div>
            {research.isPending ? <LoadingState /> : null}
            {research.data?.posts.length === 0 ? <EmptyState title="No posts yet" /> : null}
            {research.data?.posts.map((post) => (
              <PostCard key={post.id} post={post} />
            ))}
          </div>
          <aside className="rail">
            {u.reputation ? (
              <ScoreCard r={u.reputation} />
            ) : (
              <Card eyebrow="Suiem Score">
                <span className="s-small s-muted">
                  This person hasn&apos;t opted in to leaderboards, so their score is private.
                </span>
              </Card>
            )}
            {u.achievements?.length ? (
              <Card eyebrow="Recognition" tone="dark">
                {u.achievements.map((a) => (
                  <div key={a.title} className="s-stack" style={{ gap: 4 }}>
                    <h2 style={{ margin: 0, fontSize: 24 }}>{a.title}</h2>
                    <span className="s-small s-muted">{a.note}</span>
                  </div>
                ))}
              </Card>
            ) : null}
            {research.data?.activity?.length ? (
              <Card eyebrow="Recently researched">
                <ul className="list">
                  {research.data.activity.slice(0, 6).map((a) => (
                    <li key={a.entityId}>
                      <Link
                        className="entity-name grow"
                        style={{ fontSize: 19 }}
                        href={`/research/${encodeURIComponent(a.entityId)}`}
                      >
                        {a.name}
                      </Link>
                      <span className="s-small s-faint">{timeAgo(a.lastResearchedAt)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}
          </aside>
        </div>
      )}
    </>
  );
}
