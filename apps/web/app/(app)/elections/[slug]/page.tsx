"use client";
import { Avatar, Button, Card, ErrorState, LoadingState, NetworkBadge } from "@suiem/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
  candidateName,
  FINALITY_LABEL,
  isOpen,
  type Candidate,
  type Election,
  type VoteRow,
} from "../../../../components/elections/types";
import { VoteDrawer } from "../../../../components/elections/VoteDrawer";
import { api } from "../../../../lib/api";
import { timeLeft } from "../../../../lib/format";

export default function ElectionPage() {
  const { slug } = useParams<{ slug: string }>();
  const [voteFor, setVoteFor] = useState<Candidate | null>(null);
  const q = useQuery<Election>({
    queryKey: ["election", slug],
    queryFn: () => api("GET", `/elections/${slug}`),
    refetchInterval: 20_000,
  });
  const votes = useQuery<{ items: VoteRow[]; nextCursor: string | null }>({
    queryKey: ["election", slug, "votes"],
    queryFn: () => api("GET", `/elections/${slug}/votes?limit=20`),
    refetchInterval: 20_000,
  });
  if (q.isPending) return <LoadingState label="Loading election…" />;
  if (q.isError) return <ErrorState message={q.error.message} retry={() => void q.refetch()} />;
  const e = q.data;
  const open = isOpen(e);
  const total = Number(e.totalVotes) || 0;
  const sorted = [...e.candidates].sort((a, b) => Number(BigInt(b.votes) - BigInt(a.votes)));
  const left = timeLeft(e.endsAt);
  const byId = new Map(e.candidates.map((c) => [c.candidateId, c]));

  return (
    <>
      <Link href="/elections" className="s-small">
        ← All elections
      </Link>
      <div className="page-head">
        <div className="s-stack" style={{ gap: 10 }}>
          <div className="s-row" style={{ gap: 10 }}>
            <span className="s-eyebrow">{e.categoryTitle}</span>
            <NetworkBadge network="mainnet" />
            {e.labels.map((l) => (
              <span key={l} className="s-badge">
                {l}
              </span>
            ))}
          </div>
          <h1>{e.title}</h1>
          <p className="page-lede">
            {open
              ? `Voting is open${left ? ` for ${left}` : ""}. Pick a candidate to review your vote.`
              : e.result === "final"
                ? "This election is final. The result below is counted from the chain."
                : `Voting is ${e.status}.`}
          </p>
        </div>
      </div>

      <div className="cols">
        <section className="s-card s-stack" style={{ gap: 4 }}>
          <div className="section-title" style={{ marginBottom: 8 }}>
            <span className="s-eyebrow">Candidates</span>
            <span className="s-small s-faint">
              {e.tally.asOfBlock
                ? `As of block ${e.tally.asOfBlock.toLocaleString()}`
                : "No votes indexed yet"}
              {e.tally.finality ? ` · ${FINALITY_LABEL[e.tally.finality] ?? e.tally.finality}` : ""}
            </span>
          </div>
          <div>
            {sorted.map((c, i) => {
              const pct = total ? (Number(c.votes) / total) * 100 : 0;
              const winner = e.result === "final" && i === 0 && total > 0;
              return (
                <div key={c.candidateId} className="cand" data-testid="candidate">
                  <Avatar name={candidateName(c)} />
                  <div className="s-stack" style={{ gap: 6, minWidth: 0 }}>
                    <div className="s-row" style={{ gap: 8 }}>
                      {c.handle ? (
                        <Link href={`/u/${c.handle}`} className="post-author">
                          {candidateName(c)}
                        </Link>
                      ) : (
                        <span>{candidateName(c)}</span>
                      )}
                      {winner ? (
                        <span className="s-badge" data-tone="ink">
                          Winner
                        </span>
                      ) : null}
                      <span className="s-small s-faint">
                        {c.label}
                        {c.rank ? ` · #${c.rank} on ${c.board ?? "board"}` : ""}
                      </span>
                    </div>
                    <div className="bar">
                      <i style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="s-row" style={{ gap: 14, justifyContent: "flex-end" }}>
                    <span className="cand-votes">
                      {c.votes}
                      <span
                        className="s-small s-faint"
                        style={{ fontFamily: "var(--font)", marginLeft: 4 }}
                      >
                        $WIF
                      </span>
                    </span>
                    {open ? (
                      <Button variant="primary" size="sm" onClick={() => setVoteFor(c)}>
                        Vote
                      </Button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="rail">
          <Card eyebrow="Total burned" tone="dark">
            <span className="big-num">
              {e.totalVotes}
              <span style={{ fontSize: 22, marginLeft: 8 }}>$WIF</span>
            </span>
            <span className="s-small s-muted">
              {open && left ? `Closes in ${left}` : `Ended ${new Date(e.endsAt).toLocaleString()}`}
            </span>
          </Card>
          <Card eyebrow="On chain">
            <dl className="kv">
              <dt>Network</dt>
              <dd>Robinhood Chain · {e.network.chainId}</dd>
              {e.contract ? (
                <>
                  <dt>Contract</dt>
                  <dd>
                    <a
                      href={e.contract.explorerUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="s-mono"
                    >
                      {e.contract.address.slice(0, 6)}…{e.contract.address.slice(-4)}
                    </a>
                  </dd>
                </>
              ) : null}
              {e.onchainElectionId ? (
                <>
                  <dt>Election id</dt>
                  <dd className="s-num">{e.onchainElectionId}</dd>
                </>
              ) : null}
              {e.createTx ? (
                <>
                  <dt>Created in</dt>
                  <dd>
                    <a
                      href={e.createTx.explorerUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="s-mono"
                    >
                      {e.createTx.hash.slice(0, 8)}…
                    </a>
                  </dd>
                </>
              ) : null}
              <dt>Per wallet</dt>
              <dd>{e.capPerWallet ? `Up to ${e.capPerWallet} votes` : "No cap"}</dd>
            </dl>
          </Card>
          <p className="s-small s-faint" style={{ margin: 0 }}>
            {e.irreversibilityNotice}
          </p>
        </aside>
      </div>

      <section className="s-card s-stack">
        <span className="s-eyebrow">Latest votes</span>
        {votes.data?.items.length ? (
          <ul className="list">
            {votes.data.items.map((v) => {
              const c = byId.get(v.candidateId);
              return (
                <li key={v.txHash}>
                  <div className="grow">
                    <span>
                      {v.suiemMember ? (
                        `@${v.suiemMember.handle}`
                      ) : (
                        <span className="s-mono">{v.voter}</span>
                      )}
                    </span>
                    <span className="s-small s-faint">
                      {" "}
                      voted for {c ? candidateName(c) : `#${v.candidateId}`}
                    </span>
                    <div className="s-small s-faint">
                      Block {v.blockNumber.toLocaleString()} ·{" "}
                      {FINALITY_LABEL[v.finality] ?? v.finality}
                    </div>
                  </div>
                  <span className="s-serif s-num" style={{ fontSize: 22 }}>
                    {v.burned}
                  </span>
                  <a
                    href={v.explorerUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="s-small"
                  >
                    Tx ↗
                  </a>
                </li>
              );
            })}
          </ul>
        ) : (
          <span className="s-small s-muted">{votes.isPending ? "Loading…" : "No votes yet."}</span>
        )}
      </section>

      {voteFor ? (
        <VoteDrawer election={e} candidate={voteFor} onClose={() => setVoteFor(null)} />
      ) : null}
    </>
  );
}
