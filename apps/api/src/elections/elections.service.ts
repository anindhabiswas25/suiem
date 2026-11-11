/**
 * $WIF elections (mainnet 4663). Reads elections, candidates and indexed tallies; builds vote
 * previews (exact approve + vote calldata, simulated); binds a user's vote tx after verifying
 * its receipt. Tallies come ONLY from the indexer; this service never writes them.
 * Separation (ADR-0005): may read leaderboards, never writes reputation_*.
 */
import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { WIF } from "@suiem/config/chains";
import {
  explorerAddress,
  explorerTx,
  shortAddress,
  suiemElectionsAbi,
} from "@suiem/chain/elections";
import {
  burnAmount,
  decodeVote,
  decodeWifApprove,
  encodeVote,
  encodeWifApprove,
  votePreviewHash,
} from "@suiem/chain/write";
import type { DbHandle } from "@suiem/db";
import {
  burnNotice,
  CANDIDATE_LABEL,
  ELECTION_CATEGORY_TITLE,
  ELECTIONS_NETWORK_BADGE,
  IRREVERSIBILITY_NOTICE,
} from "@suiem/shared/elections";
import { newId } from "@suiem/shared/ids";
import { type Address, decodeEventLog, erc20Abi, getAddress, type Hex } from "viem";
import { ApiError } from "../http/errors";
import { CLOCK, type Clock, DB } from "../tokens";
import { ELECTIONS, type ElectionsRuntime } from "./runtime";

const PREVIEW_TTL_MS = 10 * 60_000;
const hex = (b: Buffer | null) => (b ? (`0x${b.toString("hex")}` as Hex) : null);
const buf = (h: string) => Buffer.from(h.replace(/^0x/, ""), "hex");

interface ElectionRow {
  id: string;
  slug: string;
  title: string;
  category: keyof typeof ELECTION_CATEGORY_TITLE;
  contract_address: Buffer | null;
  onchain_election_id: string | null;
  starts_at: Date;
  ends_at: Date;
  status: string;
  result_status: "none" | "provisional" | "final";
  rules: Record<string, unknown>;
  cap_per_wallet: number | null;
  create_tx_hash: Buffer | null;
  is_demo: boolean;
  finalized_at: Date | null;
}

@Injectable()
export class ElectionsService {
  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(ELECTIONS) private readonly rt: ElectionsRuntime,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get contract(): Address | null {
    return this.rt.deployment?.elections ?? null;
  }

  // ---- reads -----------------------------------------------------------------------------------

  async list(status?: string) {
    const rows = (
      await this.db.pool.query<ElectionRow>(
        `SELECT * FROM elections WHERE status <> 'draft' AND ($1::text IS NULL OR status = $1)
          ORDER BY starts_at DESC LIMIT 100`,
        [status ?? null],
      )
    ).rows;
    return { items: await Promise.all(rows.map((r) => this.view(r, false))) };
  }

  async detail(slug: string) {
    return this.view(await this.bySlug(slug), true);
  }

  private async bySlug(slug: string): Promise<ElectionRow> {
    const r = await this.db.pool.query<ElectionRow>(
      "SELECT * FROM elections WHERE slug = $1 AND status <> 'draft'",
      [slug],
    );
    if (!r.rows[0]) throw new ApiError("NOT_FOUND", "Election not found");
    return r.rows[0];
  }

  private async candidates(electionId: string) {
    return (
      await this.db.pool.query<{
        id: string;
        n: string;
        board: string | null;
        rank: number | null;
        score: string | null;
        label: keyof typeof CANDIDATE_LABEL;
        handle: string;
        display_name: string | null;
        user_status: string;
        votes: string | null;
        as_of_block: string | null;
        finality: string | null;
      }>(
        `SELECT c.id, c.onchain_candidate_id::text AS n, c.board, c.rank, c.score::text, c.label,
                u.handle, u.display_name, u.status AS user_status,
                t.votes::text, t.as_of_block::text, t.finality
           FROM election_candidates c JOIN users u ON u.id = c.user_id
           LEFT JOIN election_tallies t ON t.candidate_id = c.id AND t.election_id = c.election_id
          WHERE c.election_id = $1 ORDER BY c.onchain_candidate_id`,
        [electionId],
      )
    ).rows;
  }

  private async view(e: ElectionRow, full: boolean) {
    const contract = hex(e.contract_address);
    const cands = await this.candidates(e.id);
    const order = ["soft", "safe", "final"];
    const weakest = cands
      .map((c) => c.finality)
      .filter((f): f is string => !!f)
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
    const total = cands.reduce((s, c) => s + BigInt(c.votes ?? "0"), 0n);
    const asOf = cands.reduce((m, c) => Math.max(m, Number(c.as_of_block ?? 0)), 0);
    return {
      slug: e.slug,
      title: e.title,
      category: e.category,
      categoryTitle: ELECTION_CATEGORY_TITLE[e.category],
      labels: [
        ...(e.rules.season === "hackathon" ? ["Hackathon season"] : []),
        ...(e.is_demo ? ["Demo election"] : []),
      ],
      status: e.status,
      result:
        e.result_status === "final"
          ? "final"
          : e.result_status === "provisional"
            ? "provisional"
            : "none",
      startsAt: e.starts_at.toISOString(),
      endsAt: e.ends_at.toISOString(),
      finalizedAt: e.finalized_at?.toISOString() ?? null,
      network: { chainId: 4663, badge: ELECTIONS_NETWORK_BADGE },
      contract: contract
        ? { address: getAddress(contract), explorerUrl: explorerAddress(getAddress(contract)) }
        : null,
      onchainElectionId: e.onchain_election_id,
      createTx: e.create_tx_hash
        ? { hash: hex(e.create_tx_hash), explorerUrl: explorerTx(hex(e.create_tx_hash)!) }
        : null,
      capPerWallet: e.cap_per_wallet,
      voteAsset: { symbol: "$WIF", address: WIF.address, decimals: 18, perVote: "1" },
      irreversibilityNotice: IRREVERSIBILITY_NOTICE,
      totalVotes: total.toString(),
      tally: { asOfBlock: asOf || null, finality: weakest ?? null },
      candidates: cands.map((c) => ({
        candidateId: Number(c.n),
        handle: c.user_status === "deleted" ? null : c.handle,
        displayName: c.user_status === "deleted" ? null : c.display_name,
        board: c.board,
        rank: c.rank,
        label: CANDIDATE_LABEL[c.label],
        votes: c.votes ?? "0",
        finality: c.finality,
        asOfBlock: c.as_of_block ? Number(c.as_of_block) : null,
      })),
      ...(full ? { rules: e.rules } : {}),
    };
  }

  /** Indexed VoteCast events (newest first). Voters are short addresses; the "Suiem member" marker
   *  appears only when the linked wallet's owner allows it via wallet_visibility. */
  async votes(slug: string, viewerId: string | null, cursor: string | undefined, limit: number) {
    const e = await this.bySlug(slug);
    if (!e.contract_address) return { items: [], nextCursor: null };
    const [cb, ci] = cursor ? cursor.split(":").map(Number) : [null, null];
    const rows = (
      await this.db.pool.query<{
        tx_hash: Buffer;
        log_index: number;
        block_number: string;
        args: { voter: string; candidateId: string; votes: string };
        finality: string;
        member_handle: string | null;
      }>(
        `SELECT ev.tx_hash, ev.log_index, ev.block_number::text, ev.args, ev.finality,
                (SELECT u.handle FROM wallet_accounts w JOIN users u ON u.id = w.user_id
                   JOIN profiles p ON p.user_id = w.user_id
                  WHERE w.address = decode(substr(ev.args->>'voter', 3), 'hex') AND w.unlinked_at IS NULL
                    AND u.status = 'active'
                    AND (p.wallet_visibility = 'public' OR w.user_id = $4::uuid
                         OR (p.wallet_visibility = 'followers' AND EXISTS (
                               SELECT 1 FROM follows f WHERE f.follower_id = $4::uuid AND f.followee_id = w.user_id)))
                  LIMIT 1) AS member_handle
           FROM chain_events ev
          WHERE ev.chain_id = 4663 AND ev.contract_address = $1 AND NOT ev.removed
            AND ev.event_name = 'VoteCast' AND ev.args->>'electionId' = $2
            AND ($5::bigint IS NULL OR (ev.block_number, ev.log_index) < ($5::bigint, $6::int))
          ORDER BY ev.block_number DESC, ev.log_index DESC
          LIMIT $3`,
        [e.contract_address, e.onchain_election_id, limit + 1, viewerId, cb, ci],
      )
    ).rows;
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      items: page.map((r) => ({
        voter: shortAddress(getAddress(r.args.voter)),
        suiemMember: r.member_handle ? { handle: r.member_handle } : null,
        candidateId: Number(r.args.candidateId),
        votes: r.args.votes,
        burned: `${r.args.votes} $WIF`,
        txHash: hex(r.tx_hash),
        explorerUrl: explorerTx(hex(r.tx_hash)!),
        blockNumber: Number(r.block_number),
        finality: r.finality,
      })),
      nextCursor: rows.length > limit && last ? `${last.block_number}:${last.log_index}` : null,
    };
  }

  // ---- vote preview ----------------------------------------------------------------------------

  private async linkedWallet(userId: string): Promise<Address> {
    const w = (
      await this.db.pool.query<{ address: Buffer }>(
        `SELECT address FROM wallet_accounts WHERE user_id = $1 AND unlinked_at IS NULL
          ORDER BY linked_at DESC LIMIT 1`,
        [userId],
      )
    ).rows[0];
    if (!w) throw new ApiError("CONFLICT", "Link a wallet (Settings → Wallet) before voting");
    return getAddress(hex(w.address)!);
  }

  async preview(userId: string, slug: string, body: { candidateId: number; votes: number }) {
    const e = await this.bySlug(slug);
    const contract = this.contract;
    if (!contract || !e.contract_address || getAddress(hex(e.contract_address)!) !== contract)
      throw new ApiError(
        "CONFLICT",
        "This election is not on the deployed SuiemElections contract",
      );
    const now = this.clock.now();
    if (
      e.status === "cancelled" ||
      e.status === "finalized" ||
      now < e.starts_at ||
      now >= e.ends_at
    )
      throw new ApiError("CONFLICT", `Voting is not open (election is ${e.status})`);
    const cand = (
      await this.db.pool.query<{ id: string }>(
        "SELECT id FROM election_candidates WHERE election_id = $1 AND onchain_candidate_id = $2",
        [e.id, body.candidateId],
      )
    ).rows[0];
    if (!cand) throw new ApiError("NOT_FOUND", "Unknown candidate");
    const wallet = await this.linkedWallet(userId);
    const onchainId = BigInt(e.onchain_election_id!);
    const votes = BigInt(body.votes);
    const amount = burnAmount(votes);
    const client = this.rt.client;
    const [balance, allowance, remaining] = await Promise.all([
      client.readContract({
        address: WIF.address,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet],
      }),
      client.readContract({
        address: WIF.address,
        abi: erc20Abi,
        functionName: "allowance",
        args: [wallet, contract],
      }),
      client.readContract({
        address: contract,
        abi: suiemElectionsAbi,
        functionName: "remainingCap",
        args: [onchainId, wallet],
      }),
    ]);
    const approve = encodeWifApprove(contract, amount);
    const vote = { to: contract, data: encodeVote(onchainId, BigInt(body.candidateId), votes) };
    const problems: string[] = [];
    if (votes > remaining)
      problems.push(`Over the per-wallet cap: you can cast ${remaining} more vote(s) here`);
    if (balance < amount)
      problems.push(`Not enough $WIF: wallet holds ${balance / 10n ** 18n} whole $WIF`);

    // Simulate approve → vote from the voter's wallet against the latest state (eth_simulateV1).
    let simulation: { ok: boolean; approve: string; vote: string; error?: string };
    try {
      const sim = await client.simulateCalls({
        account: wallet,
        calls: [approve, vote],
      });
      const [a, v] = sim.results;
      simulation = {
        ok: a?.status === "success" && v?.status === "success",
        approve: a?.status ?? "unknown",
        vote: v?.status ?? "unknown",
        ...(v?.status === "failure" ? { error: v.error?.name ?? "reverted" } : {}),
      };
    } catch (error) {
      simulation = {
        ok: false,
        approve: "unknown",
        vote: "unknown",
        error: error instanceof Error ? error.name : "simulation unavailable",
      };
    }
    if (!simulation.ok && problems.length === 0) problems.push("The vote simulation failed");

    const ready = problems.length === 0;
    const hash = votePreviewHash(4663, approve, vote);
    if (ready)
      await this.db.pool.query(
        `INSERT INTO election_vote_previews (id, user_id, election_id, candidate_id, votes, wallet, preview_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          newId(),
          userId,
          e.id,
          cand.id,
          body.votes,
          buf(wallet),
          buf(hash),
          new Date(now.getTime() + PREVIEW_TTL_MS),
        ],
      );
    const decodedApprove = decodeWifApprove(approve.data);
    const decodedVote = decodeVote(vote.data);
    return {
      chainId: 4663 as const,
      network: ELECTIONS_NETWORK_BADGE,
      election: {
        slug: e.slug,
        onchainElectionId: e.onchain_election_id,
        endsAt: e.ends_at.toISOString(),
      },
      voter: wallet,
      candidateId: body.candidateId,
      votes: body.votes,
      burnAmount: amount.toString(),
      balance: balance.toString(),
      allowance: allowance.toString(),
      remainingCap: remaining.toString(),
      calls: [
        {
          step: "approve",
          to: approve.to,
          data: approve.data,
          value: "0",
          decoded: {
            function: "approve(address,uint256)",
            token: "$WIF",
            spender: decodedApprove.spender,
            amount: decodedApprove.amount.toString(),
            note: "Exact amount for this vote, never unlimited",
          },
        },
        {
          step: "vote",
          to: vote.to,
          data: vote.data,
          value: "0",
          decoded: {
            function: "vote(uint256,uint256,uint256)",
            electionId: decodedVote.electionId.toString(),
            candidateId: decodedVote.candidateId.toString(),
            votes: decodedVote.votes.toString(),
          },
        },
      ],
      simulation,
      ready,
      problems,
      notice: burnNotice(body.votes),
      irreversibilityNotice: IRREVERSIBILITY_NOTICE,
      previewHash: ready ? hash : null,
      expiresAt: ready ? new Date(now.getTime() + PREVIEW_TTL_MS).toISOString() : null,
    };
  }

  // ---- bind a vote tx to the user --------------------------------------------------------------

  async bind(
    userId: string,
    slug: string,
    body: { txHash: string; previewHash: string },
    idempotencyKey: string | undefined,
  ) {
    if (!idempotencyKey || !/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey))
      throw new ApiError(
        "IDEMPOTENCY_KEY_REQUIRED",
        "Send an Idempotency-Key header (16–128 characters)",
      );
    const route = "POST /elections/:slug/votes";
    const requestHash = createHash("sha256")
      .update(JSON.stringify({ slug, ...body }))
      .digest();
    const prior = (
      await this.db.pool.query<{ request_hash: Buffer }>(
        "SELECT request_hash FROM idempotency_keys WHERE scope = $1 AND route = $2 AND key = $3",
        [userId, route, idempotencyKey],
      )
    ).rows[0];
    if (prior && !prior.request_hash.equals(requestHash))
      throw new ApiError(
        "IDEMPOTENCY_KEY_REUSED",
        "This Idempotency-Key was used for a different request",
      );

    const e = await this.bySlug(slug);
    const txHash = body.txHash.toLowerCase() as Hex;
    const existing = (
      await this.db.pool.query<{ user_id: string; id: string }>(
        "SELECT user_id, id FROM election_vote_claims WHERE tx_hash = $1",
        [buf(txHash)],
      )
    ).rows[0];
    if (existing) {
      if (existing.user_id !== userId)
        throw new ApiError("CONFLICT", "This transaction is already bound");
      return this.claimView(existing.id);
    }
    const preview = (
      await this.db.pool.query<{
        id: string;
        wallet: Buffer;
        votes: number;
        n: string;
        created_at: Date;
      }>(
        `SELECT p.id, p.wallet, p.votes, c.onchain_candidate_id::text AS n, p.created_at
           FROM election_vote_previews p JOIN election_candidates c ON c.id = p.candidate_id
          WHERE p.user_id = $1 AND p.election_id = $2 AND p.preview_hash = $3
          ORDER BY p.created_at DESC LIMIT 1`,
        [userId, e.id, buf(body.previewHash)],
      )
    ).rows[0];
    if (!preview) throw new ApiError("NOT_FOUND", "Unknown preview for this election");
    const wallet = getAddress(hex(preview.wallet)!);
    const stillLinked = (
      await this.db.pool.query(
        "SELECT 1 FROM wallet_accounts WHERE user_id = $1 AND address = $2 AND unlinked_at IS NULL",
        [userId, preview.wallet],
      )
    ).rowCount;
    if (!stillLinked)
      throw new ApiError("FORBIDDEN", "The voting wallet is no longer linked to you");

    const client = this.rt.client;
    let tx, receipt;
    try {
      [tx, receipt] = await Promise.all([
        client.getTransaction({ hash: txHash }),
        client.getTransactionReceipt({ hash: txHash }),
      ]);
    } catch {
      throw new ApiError("CONFLICT", "Transaction not visible yet. Retry in a few seconds.");
    }
    const contract = this.contract;
    const expected = encodeVote(
      BigInt(e.onchain_election_id!),
      BigInt(preview.n),
      BigInt(preview.votes),
    );
    const wrong = (why: string) =>
      new ApiError("CONFLICT", `Transaction does not match the preview: ${why}`);
    if ((await client.getChainId()) !== 4663 || (tx.chainId !== undefined && tx.chainId !== 4663))
      throw wrong("wrong chain");
    if (!contract || !tx.to || getAddress(tx.to) !== contract) throw wrong("wrong contract");
    if (getAddress(tx.from) !== wallet) throw wrong("sent from a different wallet");
    if (tx.input.toLowerCase() !== expected.toLowerCase()) throw wrong("different vote");
    if (receipt.status !== "success") throw wrong("the transaction reverted");
    const voted = receipt.logs.some((l) => {
      if (getAddress(l.address) !== contract) return false;
      try {
        const d = decodeEventLog({ abi: suiemElectionsAbi, data: l.data, topics: l.topics });
        return (
          d.eventName === "VoteCast" &&
          getAddress(d.args.voter) === wallet &&
          d.args.electionId === BigInt(e.onchain_election_id!) &&
          d.args.candidateId === BigInt(preview.n) &&
          d.args.votes === BigInt(preview.votes)
        );
      } catch {
        return false;
      }
    });
    if (!voted) throw wrong("no matching VoteCast event");

    const id = newId();
    try {
      await this.db.pool.query(
        `INSERT INTO election_vote_claims (id, election_id, user_id, preview_id, wallet, tx_hash)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, e.id, userId, preview.id, preview.wallet, buf(txHash)],
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505")
        throw new ApiError("CONFLICT", "This transaction is already bound");
      throw error;
    }
    if (!prior)
      await this.db.pool.query(
        `INSERT INTO idempotency_keys (scope, route, key, request_hash, expires_at)
         VALUES ($1, $2, $3, $4, now() + interval '1 day') ON CONFLICT DO NOTHING`,
        [userId, route, idempotencyKey, requestHash],
      );
    return this.claimView(id);
  }

  private async claimView(id: string) {
    const r = (
      await this.db.pool.query<{
        id: string;
        slug: string;
        tx_hash: Buffer;
        wallet: Buffer;
        votes: number;
        n: string;
        finality: string | null;
        created_at: Date;
      }>(
        `SELECT cl.id, e.slug, cl.tx_hash, cl.wallet, p.votes, c.onchain_candidate_id::text AS n,
                (SELECT ev.finality FROM chain_events ev WHERE ev.tx_hash = cl.tx_hash AND ev.chain_id = 4663
                   AND ev.event_name = 'VoteCast' AND NOT ev.removed LIMIT 1) AS finality,
                cl.created_at
           FROM election_vote_claims cl JOIN elections e ON e.id = cl.election_id
           JOIN election_vote_previews p ON p.id = cl.preview_id
           JOIN election_candidates c ON c.id = p.candidate_id
          WHERE cl.id = $1`,
        [id],
      )
    ).rows[0]!;
    return {
      id: r.id,
      election: r.slug,
      candidateId: Number(r.n),
      votes: r.votes,
      burned: `${r.votes} $WIF`,
      wallet: getAddress(hex(r.wallet)!),
      txHash: hex(r.tx_hash),
      explorerUrl: explorerTx(hex(r.tx_hash)!),
      indexed: r.finality !== null,
      finality: r.finality,
      boundAt: r.created_at.toISOString(),
      note: "Tallies come only from the indexer; binding links this vote to your account.",
    };
  }

  async myVotes(userId: string) {
    const ids = (
      await this.db.pool.query<{ id: string }>(
        "SELECT id FROM election_vote_claims WHERE user_id = $1 ORDER BY created_at DESC LIMIT 200",
        [userId],
      )
    ).rows;
    return { items: await Promise.all(ids.map((r) => this.claimView(r.id))) };
  }

  /** Winner badges: finalized elections with a FINAL result only. An achievement, never score evidence. */
  async achievements(userId: string) {
    const rows = (
      await this.db.pool.query<{
        slug: string;
        title: string;
        category: keyof typeof ELECTION_CATEGORY_TITLE;
        finalized_at: Date | null;
      }>(
        `SELECT e.slug, e.title, e.category, e.finalized_at
           FROM elections e JOIN election_candidates c ON c.election_id = e.id
           JOIN election_tallies t ON t.candidate_id = c.id AND t.election_id = e.id
          WHERE c.user_id = $1 AND e.status = 'finalized' AND e.result_status = 'final' AND t.votes > 0
            AND t.votes = (SELECT max(t2.votes) FROM election_tallies t2 WHERE t2.election_id = e.id)
          ORDER BY e.finalized_at DESC NULLS LAST`,
        [userId],
      )
    ).rows;
    return rows.map((r) => ({
      kind: "election_winner" as const,
      title: `${ELECTION_CATEGORY_TITLE[r.category]} · ${r.title} winner`,
      election: r.slug,
      awardedAt: r.finalized_at?.toISOString() ?? null,
      note: "Community spotlight. Not part of the Suiem Score.",
    }));
  }
}
