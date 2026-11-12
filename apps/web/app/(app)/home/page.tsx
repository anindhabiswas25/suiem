"use client";
import type {
  briefListResponse,
  thesisListResponse,
  watchlistsResponse,
} from "@suiem/shared/schemas";
import type { PostView } from "@suiem/shared/social";
import { Avatar, Button, Card } from "@suiem/ui";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import type { z } from "zod";
import { candidateName, isOpen, type Election } from "../../../components/elections/types";
import { EntitySearch } from "../../../components/research/ui";
import { FeedList, type FeedPage } from "../../../components/social/FeedList";
import { Composer } from "../../../components/social/Post";
import { api } from "../../../lib/api";
import { greeting, timeAgo, timeLeft } from "../../../lib/format";
import { useMe } from "../../../lib/session";

function ElectionCallout() {
  const q = useQuery<{ items: Election[] }>({
    queryKey: ["elections"],
    queryFn: () => api("GET", "/elections"),
  });
  const open = q.data?.items.find((e) => isOpen(e));
  const last = q.data?.items.find((e) => e.result === "final");
  const e = open ?? last;
  if (!e)
    return (
      <Card eyebrow="Weekly election" tone="dark">
        <h2 style={{ margin: 0, fontSize: 28 }}>Recognise good research</h2>
        <p className="s-muted" style={{ margin: 0 }}>
          The community votes for helpful contributors by burning $WIF on mainnet.
        </p>
        <Link
          href="/elections"
          className="s-btn"
          data-variant="primary"
          style={{ width: "fit-content" }}
        >
          See elections
        </Link>
      </Card>
    );
  const leader = [...e.candidates].sort((a, b) => Number(BigInt(b.votes) - BigInt(a.votes)))[0];
  const left = timeLeft(e.endsAt);
  return (
    <Card eyebrow={open ? "This week's election" : "Last election"} tone="dark">
      <h2 style={{ margin: 0, fontSize: 28 }}>{e.title}</h2>
      <p className="s-muted" style={{ margin: 0 }}>
        {e.candidates.length} candidates · {e.totalVotes} $WIF burned
        {open && left ? ` · closes in ${left}` : ""}
        {!open && leader && Number(e.totalVotes) ? ` · winner ${candidateName(leader)}` : ""}
      </p>
      <Link
        href={`/elections/${e.slug}`}
        className="s-btn"
        data-variant="primary"
        style={{ width: "fit-content" }}
      >
        {open ? "See candidates" : "See result"}
      </Link>
    </Card>
  );
}

interface ScoreCardData {
  maturity: "building" | "ranked";
  suiemScore: string | null;
  investorScore: string | null;
  contributionScore: string | null;
  progress: Record<string, { have: number; need: number }>;
}

function ScoreSummary({ handle }: { handle: string }) {
  const q = useQuery<ScoreCardData>({
    queryKey: ["reputation", handle],
    queryFn: () => api("GET", `/profiles/${handle}/reputation`),
  });
  const r = q.data;
  return (
    <Card eyebrow="Your Suiem Score">
      {r?.maturity === "ranked" ? (
        <>
          <span className="big-num">{Number(r.suiemScore ?? 0).toFixed(1)}</span>
          {[
            ["Investor process", r.investorScore],
            ["Community contribution", r.contributionScore],
          ].map(([label, v]) => (
            <div key={label} className="s-stack" style={{ gap: 6 }}>
              <span className="s-small s-muted">{label}</span>
              <div className="bar">
                <i style={{ width: `${Math.min(100, Number(v ?? 0))}%` }} />
              </div>
            </div>
          ))}
        </>
      ) : (
        <>
          <h2 style={{ margin: 0, fontSize: 28 }}>Building track record</h2>
          <span className="s-small s-muted">
            Write theses, help others and practise on testnet. Your score appears once there is
            enough evidence.
          </span>
          {r?.progress?.decisions ? (
            <div className="s-stack" style={{ gap: 6 }}>
              <span className="s-small s-muted">
                Decisions {Math.min(r.progress.decisions.have, r.progress.decisions.need)} of{" "}
                {r.progress.decisions.need}
              </span>
              <div className="bar">
                <i
                  style={{
                    width: `${Math.min(100, (r.progress.decisions.have / Math.max(1, r.progress.decisions.need)) * 100)}%`,
                  }}
                />
              </div>
            </div>
          ) : null}
        </>
      )}
      <span className="s-small s-faint">Votes never change anyone&apos;s score.</span>
      <Link href={`/u/${handle}`} className="s-small">
        Open your profile
      </Link>
    </Card>
  );
}

function Trending() {
  const feed = useInfiniteQuery<FeedPage>({
    queryKey: ["feed", "discover", null],
    initialPageParam: null as string | null,
    queryFn: () => api("GET", "/feed?tab=discover"),
    getNextPageParam: (p) => p.nextCursor,
  });
  const trending = feed.data?.pages[0]?.trending ?? [];
  if (!trending.length) return null;
  return (
    <Card eyebrow="Talked about this week">
      <ul className="list">
        {trending.slice(0, 5).map((t, i) => (
          <li key={t.id}>
            <span className="s-small s-faint s-num">{i + 1}</span>
            <Link className="post-author grow" href={`/research/${encodeURIComponent(t.id)}`}>
              {t.name}
            </Link>
            <span className="s-small s-faint s-num">
              {t.activity} post{t.activity === 1 ? "" : "s"}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** People posting in Discover that you don't already see in Following. */
function WhoToFollow({ myId }: { myId: string }) {
  const qc = useQueryClient();
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const discover = useInfiniteQuery<FeedPage>({
    queryKey: ["feed", "discover", null],
    initialPageParam: null as string | null,
    queryFn: () => api("GET", "/feed?tab=discover"),
    getNextPageParam: (p) => p.nextCursor,
  });
  const following = useInfiniteQuery<FeedPage>({
    queryKey: ["feed", "following", null],
    initialPageParam: null as string | null,
    queryFn: () => api("GET", "/feed?tab=following"),
    getNextPageParam: (p) => p.nextCursor,
  });
  const follow = useMutation({
    mutationFn: (id: string) => api("POST", `/users/${id}/follow`),
    onSuccess: (_d, id) => {
      setFollowed((s) => new Set(s).add(id));
      void qc.invalidateQueries({ queryKey: ["feed", "following"] });
    },
  });
  const seen = new Set(
    (following.data?.pages ?? []).flatMap((p) => p.items.map((i) => i.author.id)),
  );
  const people = new Map<string, PostView["author"]>();
  for (const p of discover.data?.pages[0]?.items ?? []) {
    const a = p.author;
    if (a.id === myId || people.has(a.id)) continue;
    if (seen.has(a.id) && !followed.has(a.id)) continue;
    people.set(a.id, a);
  }
  if (!people.size) return null;
  return (
    <Card eyebrow="Who to follow">
      <ul className="list">
        {[...people.values()].slice(0, 4).map((a) => {
          const name = a.displayName ?? a.handle;
          const done = followed.has(a.id);
          return (
            <li key={a.id}>
              <Avatar name={name} />
              <div className="grow" style={{ minWidth: 0 }}>
                <Link href={`/u/${a.handle}`} className="post-author">
                  {name}
                </Link>
                <div className="s-small s-faint">@{a.handle}</div>
              </div>
              <Button
                size="sm"
                variant={done ? undefined : "primary"}
                disabled={done}
                loading={follow.isPending && follow.variables === a.id}
                onClick={() => follow.mutate(a.id)}
              >
                {done ? "Following" : "Follow"}
              </Button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function ContinueResearching() {
  const briefs = useQuery<z.infer<typeof briefListResponse>>({
    queryKey: ["briefs", "home"],
    queryFn: () => api("GET", "/research/briefs?limit=6"),
  });
  const theses = useQuery<z.infer<typeof thesisListResponse>>({
    queryKey: ["theses"],
    queryFn: () => api("GET", "/theses"),
  });
  const lists = useQuery<z.infer<typeof watchlistsResponse>>({
    queryKey: ["watchlists"],
    queryFn: () => api("GET", "/watchlists"),
  });
  const drafts = (theses.data?.items ?? []).filter((t) => t.status === "draft");
  const watched = (lists.data?.items ?? []).flatMap((l) => l.items);
  const rows = [
    ...drafts.slice(0, 2).map((t) => ({
      key: t.id,
      href: `/theses/${t.id}`,
      name: t.entityName,
      sub: `Thesis draft · ${t.title}`,
    })),
    ...(briefs.data?.items ?? []).slice(0, 3).map((b) => ({
      key: b.id,
      href: `/research/${encodeURIComponent(b.entityId)}`,
      name: b.entityName,
      sub: `Brief · ${timeAgo(b.generatedAt)}`,
    })),
  ];
  return (
    <Card eyebrow="Your research">
      {rows.length ? (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.key}>
              <div className="grow">
                <Link href={r.href} className="post-author">
                  {r.name}
                </Link>
                <div className="s-small s-faint">{r.sub}</div>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <span className="s-small s-muted">
          Search a company above, request a sourced brief, then write down your reasoning as a
          thesis.
        </span>
      )}
      <div className="s-row" style={{ gap: 14 }}>
        <Link href="/watchlist" className="s-small">
          Watchlist{watched.length ? ` (${watched.length})` : ""}
        </Link>
        <Link href="/research" className="s-small">
          All research
        </Link>
      </div>
    </Card>
  );
}

export default function Home() {
  const me = useMe();
  const [tab, setTab] = useState<"discover" | "following">("discover");
  const user = me.data;
  if (!user) return null;
  const name = user.displayName ?? user.handle;

  return (
    <div className="cols">
      <div className="s-stack" style={{ gap: 14 }}>
        <div className="home-head">
          <div>
            <span className="s-eyebrow">
              {new Date().toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </span>
            <h1>
              {greeting()}, {name}
            </h1>
          </div>
          <div className="home-tabs" role="tablist" aria-label="Feed">
            {(
              [
                ["discover", "For you"],
                ["following", "Following"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <Composer placeholder="What are you researching? Cite your sources." />
        <FeedList key={tab} tab={tab} />
        <p className="s-small s-faint" style={{ textAlign: "center", margin: 0 }}>
          Ranked by recency and how helpful people found each post. Never by what anyone holds, and
          nothing here tells you what to buy.
        </p>
      </div>

      <aside className="rail">
        <section className="s-card s-stack" style={{ gap: 10 }}>
          <span className="s-eyebrow">Research a company</span>
          <EntitySearch />
        </section>
        <ElectionCallout />
        <Trending />
        <WhoToFollow myId={user.id} />
        <ContinueResearching />
        <ScoreSummary handle={user.handle} />
      </aside>
    </div>
  );
}
