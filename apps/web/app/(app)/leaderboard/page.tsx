"use client";
import { Avatar, Card, EmptyState, ErrorState, LoadingState } from "@suiem/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { PageHeader, TabLinks } from "../../../components/AppShell";
import { CommunityTabs } from "../../../components/social/CommunityTabs";
import { api } from "../../../lib/api";

interface Board {
  board: string;
  title: string;
  label: string;
  period: "week" | "all";
  methodologyVersion: string;
  performanceLabel: string;
  badge: string | null;
  rows: {
    rank: number;
    handle: string;
    displayName: string | null;
    isDemo: boolean;
    score: string;
    suiemScore: string;
    investorScore: string;
    contributionScore: string;
  }[];
}

const BOARDS = [
  { key: "suiem", label: "Suiem Score" },
  { key: "research", label: "Research" },
  { key: "investors", label: "Investors" },
] as const;

function Leaderboard() {
  const sp = useSearchParams();
  const board = BOARDS.find((b) => b.key === sp.get("board"))?.key ?? "suiem";
  const period = sp.get("period") === "all" ? "all" : "week";
  const q = useQuery<Board>({
    queryKey: ["leaderboard", board, period],
    queryFn: () => api("GET", `/leaderboards/${board}?period=${period}&showDemo=false`),
  });
  const href = (p: Record<string, string>) =>
    `/leaderboard?${new URLSearchParams({ board, period, ...p })}`;
  return (
    <>
      <PageHeader title="Leaderboard" eyebrow="Community">
        Ranked by evidence: investing process and helpful contributions, 50/50. Only people who
        opted in appear. $WIF holdings and votes never change a score.
      </PageHeader>
      <CommunityTabs current="leaderboard" />
      <div className="cols">
        <section className="s-card s-stack" style={{ gap: 16 }}>
          <div className="s-row" style={{ justifyContent: "space-between" }}>
            <TabLinks
              label="Board"
              current={board}
              tabs={BOARDS.map((b) => ({
                key: b.key,
                label: b.label,
                href: href({ board: b.key }),
              }))}
            />
            <TabLinks
              label="Period"
              current={period}
              tabs={[
                { key: "week", label: "This week", href: href({ period: "week" }) },
                { key: "all", label: "All time", href: href({ period: "all" }) },
              ]}
            />
          </div>
          {q.data ? <span className="s-small s-muted">{q.data.label}</span> : null}
          {q.isPending ? <LoadingState /> : null}
          {q.isError ? (
            <ErrorState message={q.error.message} retry={() => void q.refetch()} />
          ) : null}
          {q.data && q.data.rows.length === 0 ? (
            <EmptyState title="Nobody is ranked here yet">
              Scores appear once there is enough evidence: decisions, active days and ratings.
            </EmptyState>
          ) : null}
          {q.data?.rows.length ? (
            <ol className="list" data-testid="leaderboard">
              {q.data.rows.map((r) => (
                <li key={r.handle}>
                  <span
                    className="s-serif s-num"
                    style={{
                      fontSize: 28,
                      width: 40,
                      color: r.rank <= 3 ? "var(--text)" : "var(--text-faint)",
                    }}
                  >
                    {r.rank}
                  </span>
                  <Avatar name={r.displayName ?? r.handle} />
                  <div className="grow">
                    <Link href={`/u/${r.handle}`} className="post-author">
                      {r.displayName ?? r.handle}
                    </Link>
                    <div className="s-small s-faint">@{r.handle}</div>
                  </div>
                  <span className="s-serif s-num" style={{ fontSize: 30 }}>
                    {Number(r.score).toFixed(1)}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}
        </section>
        <aside className="rail">
          <Card eyebrow="How scores work">
            <div className="split-bars s-stack" style={{ gap: 10 }}>
              <div className="s-stack" style={{ gap: 6 }}>
                <span className="s-small">Investor process · 50%</span>
                <div className="bar">
                  <i style={{ width: "50%" }} />
                </div>
              </div>
              <div className="s-stack" style={{ gap: 6 }}>
                <span className="s-small">Community contribution · 50%</span>
                <div className="bar">
                  <i style={{ width: "50%" }} />
                </div>
              </div>
            </div>
            <span className="s-small s-muted">
              {q.data?.performanceLabel ?? "Investor results use simulated and testnet books."}{" "}
              Methodology {q.data?.methodologyVersion ?? ""}.
            </span>
          </Card>
          <Card eyebrow="Weekly election" tone="dark">
            <h2 style={{ margin: 0, fontSize: 26 }}>The top of this board can win</h2>
            <p className="s-muted" style={{ margin: 0 }}>
              Election candidates come from these boards. The community votes by burning $WIF.
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
        </aside>
      </div>
    </>
  );
}

export default function LeaderboardPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Leaderboard />
    </Suspense>
  );
}
