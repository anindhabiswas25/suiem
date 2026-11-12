"use client";
import { robinhoodMainnet } from "@suiem/config/chains";
import { Alert, Avatar, Button, NetworkBadge } from "@suiem/ui";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getAddress, type Hex } from "viem";
import { useAccount, useConnect, useSendTransaction, useSwitchChain } from "wagmi";
import { getAccount, waitForTransactionReceipt } from "wagmi/actions";
import { api, ApiRequestError } from "../../lib/api";
import { formatUnits18 } from "../../lib/format";
import { wagmiConfig } from "../../lib/wagmi";
import {
  candidateName,
  type Candidate,
  type Election,
  type VoteClaim,
  type VotePreview,
} from "./types";

const MAINNET = robinhoodMainnet.id;
const EXPLORER = robinhoodMainnet.blockExplorers.default.url;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type Phase = "choose" | "review" | "approve" | "vote" | "bind" | "done";
const STEPS: { key: Phase[]; label: string }[] = [
  { key: ["choose", "review"], label: "Review" },
  { key: ["approve"], label: "Approve" },
  { key: ["vote", "bind"], label: "Vote" },
  { key: ["done"], label: "Recorded" },
];

function Stepper({ phase }: { phase: Phase }) {
  const at = STEPS.findIndex((s) => s.key.includes(phase));
  return (
    <ol className="stepper" aria-label={`Step ${at + 1} of ${STEPS.length}`}>
      {STEPS.map((s, i) => (
        <li key={s.label} data-state={i < at ? "done" : i === at ? "current" : "todo"}>
          <b>{i < at ? "✓" : i + 1}</b>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

const errText = (e: unknown) => {
  if (e instanceof ApiRequestError) return e.message;
  if (e instanceof Error) {
    const m = e.message.split("\n")[0] ?? e.message;
    return /reject|denied/i.test(m)
      ? "You cancelled the request in your wallet. Nothing was sent."
      : m;
  }
  return "Something went wrong";
};

/**
 * Burn-to-vote on mainnet. Review → exact approve (only if allowance is short) → vote → bind.
 * The API only builds calldata; the user's own wallet signs and sends both transactions.
 */
export function VoteDrawer({
  election,
  candidate,
  onClose,
}: {
  election: Election;
  candidate: Candidate;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>("choose");
  const [votes, setVotes] = useState(1);
  const [preview, setPreview] = useState<VotePreview | null>(null);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [linkWallet, setLinkWallet] = useState(false);
  const [txs, setTxs] = useState<{ approve?: Hex; vote?: Hex }>({});
  const [claim, setClaim] = useState<VoteClaim | null>(null);
  const idem = useRef(crypto.randomUUID().replace(/-/g, ""));
  const account = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [busy, onClose]);

  async function review() {
    setBusy(true);
    setError(null);
    setLinkWallet(false);
    try {
      const p = await api<VotePreview>("POST", `/elections/${election.slug}/vote/preview`, {
        candidateId: candidate.candidateId,
        votes,
      });
      setPreview(p);
      setAck(false);
      setPhase("review");
    } catch (e) {
      setError(errText(e));
      if (e instanceof ApiRequestError && /link a wallet/i.test(e.message)) setLinkWallet(true);
    } finally {
      setBusy(false);
    }
  }

  async function ensureWallet(p: VotePreview) {
    if (!getAccount(wagmiConfig).address) await connectAsync({ connector: connectors[0]! });
    const a = getAccount(wagmiConfig);
    if (!a.address || getAddress(a.address) !== getAddress(p.voter))
      throw new Error(
        `Switch your wallet to the linked address ${short(p.voter)}, then try again.`,
      );
    if (a.chainId !== MAINNET) await switchChainAsync({ chainId: MAINNET });
  }

  async function run() {
    if (!preview?.previewHash) return;
    setBusy(true);
    setError(null);
    try {
      await ensureWallet(preview);
      const [approve, vote] = preview.calls;
      if (BigInt(preview.allowance) < BigInt(preview.burnAmount) && approve && !txs.approve) {
        setPhase("approve");
        const h = await sendTransactionAsync({
          to: getAddress(approve.to),
          data: approve.data as Hex,
          chainId: MAINNET,
        });
        setTxs((t) => ({ ...t, approve: h }));
        await waitForTransactionReceipt(wagmiConfig, { hash: h, chainId: MAINNET });
      }
      setPhase("vote");
      const hash =
        txs.vote ??
        (await sendTransactionAsync({
          to: getAddress(vote!.to),
          data: vote!.data as Hex,
          chainId: MAINNET,
        }));
      setTxs((t) => ({ ...t, vote: hash }));
      await waitForTransactionReceipt(wagmiConfig, { hash, chainId: MAINNET });
      setPhase("bind");
      let c: VoteClaim | null = null;
      for (let n = 0; n < 10 && !c; n++) {
        try {
          c = await api<VoteClaim>(
            "POST",
            `/elections/${election.slug}/votes`,
            { txHash: hash, previewHash: preview.previewHash },
            { "Idempotency-Key": idem.current },
          );
        } catch (e) {
          if (
            n === 9 ||
            (e instanceof ApiRequestError &&
              e.status < 500 &&
              !/not (yet )?visible|not found/i.test(e.message))
          )
            throw e;
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
      setClaim(c);
      setPhase("done");
      void qc.invalidateQueries({ queryKey: ["elections"] });
      void qc.invalidateQueries({ queryKey: ["election", election.slug] });
      void qc.invalidateQueries({ queryKey: ["my-votes"] });
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  const name = candidateName(candidate);
  const needsApprove = preview ? BigInt(preview.allowance) < BigInt(preview.burnAmount) : true;

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Vote for ${name}`}>
        <div className="s-row" style={{ justifyContent: "space-between" }}>
          <Stepper phase={phase} />
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy} aria-label="Close">
            Close
          </Button>
        </div>

        <section className="s-card s-stack" style={{ gap: 16 }}>
          <div className="s-row" style={{ justifyContent: "space-between" }}>
            <span className="s-eyebrow">You are voting for</span>
            <NetworkBadge network="mainnet" />
          </div>
          <div className="s-row" style={{ gap: 14 }}>
            <Avatar name={name} />
            <div className="s-stack" style={{ gap: 2 }}>
              <h2 style={{ margin: 0, fontSize: 30 }}>{name}</h2>
              <span className="s-small s-faint">
                {election.categoryTitle} · {candidate.label}
              </span>
            </div>
          </div>

          {phase === "choose" ? (
            <>
              <div className="s-field">
                <label htmlFor="votes">How many votes? 1 vote burns 1 $WIF.</label>
                <div className="s-row" style={{ gap: 8 }}>
                  <Button
                    size="sm"
                    onClick={() => setVotes(Math.max(1, votes - 1))}
                    aria-label="Fewer votes"
                  >
                    −
                  </Button>
                  <input
                    id="votes"
                    className="s-input s-num"
                    style={{ width: 90, textAlign: "center" }}
                    inputMode="numeric"
                    value={votes}
                    onChange={(e) =>
                      setVotes(
                        Math.max(
                          1,
                          Math.min(1_000_000, Number(e.target.value.replace(/\D/g, "")) || 1),
                        ),
                      )
                    }
                  />
                  <Button size="sm" onClick={() => setVotes(votes + 1)} aria-label="More votes">
                    +
                  </Button>
                  {election.capPerWallet ? (
                    <span className="s-small s-faint">
                      Up to {election.capPerWallet} per wallet
                    </span>
                  ) : null}
                </div>
              </div>
              <Button variant="primary" block loading={busy} onClick={() => void review()}>
                Review vote
              </Button>
            </>
          ) : null}

          {preview && phase !== "choose" ? (
            <>
              <div className="burn-amt" data-testid="burn-amount">
                {formatUnits18(preview.burnAmount)} <small>$WIF</small>
              </div>
              <p className="s-small s-muted" style={{ margin: 0, textAlign: "center" }}>
                will be burned permanently on Robinhood Chain mainnet
              </p>
              <dl className="kv">
                <dt>Your balance</dt>
                <dd className="s-num">
                  {formatUnits18(preview.balance)} →{" "}
                  {formatUnits18((BigInt(preview.balance) - BigInt(preview.burnAmount)).toString())}{" "}
                  $WIF
                </dd>
                <dt>Approval</dt>
                <dd>
                  {needsApprove
                    ? `Exactly ${formatUnits18(preview.burnAmount)} $WIF, not unlimited`
                    : "Not needed"}
                </dd>
                <dt>Wallet</dt>
                <dd className="s-mono">{short(preview.voter)}</dd>
                {election.contract ? (
                  <>
                    <dt>Contract</dt>
                    <dd>
                      <a
                        href={election.contract.explorerUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="s-mono"
                      >
                        {short(election.contract.address)}
                      </a>
                    </dd>
                  </>
                ) : null}
                <dt>Votes left for this wallet</dt>
                <dd className="s-num">{preview.remainingCap}</dd>
                <dt>Simulation</dt>
                <dd>{preview.simulation.ok ? "Passed" : "Failed"}</dd>
              </dl>
              {preview.problems.length ? (
                <Alert tone="negative">
                  {preview.problems.map((p) => (
                    <div key={p}>{p}</div>
                  ))}
                </Alert>
              ) : null}
              {phase === "review" && preview.ready ? (
                <label className="s-check s-alert" style={{ background: "var(--surface-2)" }}>
                  <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  <span className="s-small">{preview.notice}</span>
                </label>
              ) : null}
            </>
          ) : null}

          {phase === "done" && claim ? (
            <Alert tone="info">
              <div className="s-stack" style={{ gap: 6 }}>
                <b style={{ fontWeight: 500 }}>Vote recorded</b>
                <span className="s-small">
                  {claim.burned} burned for {name}.{" "}
                  {claim.indexed
                    ? `Indexed (${claim.finality ?? "seen"}).`
                    : "The indexer will count it within a minute."}
                </span>
                <a
                  href={claim.explorerUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="s-small"
                >
                  View transaction on the explorer ↗
                </a>
              </div>
            </Alert>
          ) : null}

          {txs.approve || txs.vote ? (
            <div className="s-stack s-small" style={{ gap: 4 }}>
              {txs.approve ? (
                <a href={`${EXPLORER}/tx/${txs.approve}`} target="_blank" rel="noreferrer noopener">
                  Approval tx {short(txs.approve)} ↗
                </a>
              ) : null}
              {txs.vote ? (
                <a href={`${EXPLORER}/tx/${txs.vote}`} target="_blank" rel="noreferrer noopener">
                  Vote tx {short(txs.vote)} ↗
                </a>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <Alert tone="negative">
              {error}{" "}
              {linkWallet ? <Link href="/settings#wallet">Link a wallet in Settings</Link> : null}
            </Alert>
          ) : null}

          {phase === "review" ? (
            <div className="s-row" style={{ gap: 10 }}>
              <Button onClick={() => setPhase("choose")} disabled={busy}>
                Back
              </Button>
              <Button
                variant="primary"
                style={{ flex: 1 }}
                disabled={!preview?.ready || !ack}
                loading={busy}
                onClick={() => void run()}
              >
                {needsApprove
                  ? `Approve ${preview ? formatUnits18(preview.burnAmount) : ""} $WIF`
                  : "Burn and vote"}
              </Button>
            </div>
          ) : null}
          {phase === "approve" || phase === "vote" || phase === "bind" ? (
            <div className="s-stack" style={{ gap: 10 }}>
              <span className="s-row s-small s-muted">
                {busy ? <span className="s-spinner" aria-hidden="true" /> : null}
                {phase === "approve"
                  ? "Confirm the exact approval in your wallet…"
                  : phase === "vote"
                    ? "Confirm the vote in your wallet. This burns your $WIF…"
                    : "Recording your vote with Suiem…"}
              </span>
              {!busy && error ? (
                <Button variant="primary" onClick={() => void run()}>
                  Try again
                </Button>
              ) : null}
            </div>
          ) : null}
          {phase === "done" ? (
            <Button variant="primary" block onClick={onClose}>
              Done
            </Button>
          ) : null}
        </section>

        <p className="s-small s-faint" style={{ margin: 0 }}>
          {election.irreversibilityNotice}
        </p>
        {account.address ? (
          <span className="s-small s-faint">Wallet connected: {short(account.address)}</span>
        ) : null}
      </aside>
    </div>
  );
}
