/**
 * Owner-side election creation (used by `pnpm elections:create`). The DB row is inserted as a draft
 * with its frozen candidate snapshot BEFORE the onchain transaction; after the receipt it becomes
 * `scheduled` with the contract address, onchain id and tx hash. Triggers forbid any later change
 * to rules, times, cap or candidates (migration 0008).
 */
import { newId } from "@suiem/shared/ids";
import { IRREVERSIBILITY_NOTICE } from "@suiem/shared/elections";
import type { Pool, PoolClient } from "pg";
import { BOARD_FOR, type CandidateSnapshot, type ElectionCategory } from "./candidates";

export interface ElectionPlan {
  slug: string;
  title: string;
  category: ElectionCategory;
  startsAt: Date;
  endsAt: Date;
  capPerWallet: number;
  demo: boolean;
}

export function buildRules(plan: ElectionPlan, candidates: CandidateSnapshot[]) {
  if (plan.demo && !/Demo election/.test(plan.title))
    throw new Error('A demo election must say "Demo election" in its title');
  const fallback = candidates.some((c) => c.label === "building_track_record");
  return {
    season: "hackathon",
    labels: ["Hackathon season", ...(plan.demo ? ["Demo election"] : [])],
    demo: plan.demo,
    board: BOARD_FOR[plan.category],
    period: "week",
    candidateSource: fallback ? "leaderboard+fallback" : "leaderboard",
    fallbackRule: fallback
      ? BOARD_FOR[plan.category] === "research"
        ? "Fewer than 2 ranked rows: filled with opted-in users with at least one public published thesis in the last 7 days (Building track record)"
        : "Fewer than 2 ranked rows: filled with opted-in users with at least one reconciled testnet/simulated trade (Building track record)"
      : null,
    eligibility:
      "appear_in_leaderboards, status active, no open moderation action, not a demo account" +
      (plan.demo ? " (demo accounts allowed: Demo election)" : ""),
    voteWeight: "1 $WIF = 1 vote, whole tokens only, linear",
    capPerWallet: plan.capPerWallet,
    finality: "Results are final only after ElectionFinalized reaches the finalized block tag",
    irreversibility: IRREVERSIBILITY_NOTICE,
    candidates: candidates.map((c, i) => ({
      candidateId: i + 1,
      handle: c.handle,
      board: c.board,
      rank: c.rank,
      score: c.score,
      label: c.label,
      methodologyVersion: c.methodologyVersion,
    })),
    snapshotAt: new Date().toISOString(),
  };
}

export async function insertDraft(
  pool: Pool,
  plan: ElectionPlan,
  candidates: CandidateSnapshot[],
): Promise<string> {
  if (candidates.length === 0) throw new Error("No eligible candidates");
  const id = newId();
  const client: PoolClient = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO elections (id, slug, title, category, chain_id, starts_at, ends_at, status, rules, cap_per_wallet, is_demo)
       VALUES ($1, $2, $3, $4, 4663, $5, $6, 'draft', $7, $8, $9)`,
      [
        id,
        plan.slug,
        plan.title,
        plan.category,
        plan.startsAt,
        plan.endsAt,
        buildRules(plan, candidates),
        plan.capPerWallet,
        plan.demo,
      ],
    );
    for (const [i, c] of candidates.entries())
      await client.query(
        `INSERT INTO election_candidates (id, election_id, user_id, onchain_candidate_id, board, rank, score, label)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [newId(), id, c.userId, i + 1, c.board, c.rank, c.score, c.label],
      );
    await client.query("COMMIT");
    return id;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function markCreated(
  pool: Pick<Pool, "query">,
  id: string,
  onchain: { contract: string; electionId: bigint; txHash: string },
) {
  await pool.query(
    `UPDATE elections SET status = 'scheduled', contract_address = $2, onchain_election_id = $3, create_tx_hash = $4
      WHERE id = $1 AND status = 'draft'`,
    [
      id,
      Buffer.from(onchain.contract.slice(2), "hex"),
      onchain.electionId.toString(),
      Buffer.from(onchain.txHash.slice(2), "hex"),
    ],
  );
}
