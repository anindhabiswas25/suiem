import { Inject, Injectable } from "@nestjs/common";
import type { DbHandle } from "@suiem/db";
import { ACTIVE_METHODOLOGY, diffSnapshots, type Snapshot } from "@suiem/reputation";
import { DB } from "../tokens";
import { REPUTATION, type ReputationRuntime } from "./reputation.runtime";

/** The score card: latest snapshot, its maturity and "What changed" since the previous one. */
@Injectable()
export class ReputationView {
  constructor(
    @Inject(DB) private readonly db: DbHandle,
    @Inject(REPUTATION) private readonly rt: ReputationRuntime,
  ) {}

  async forUser(userId: string) {
    let row = (
      await this.db.pool.query<{
        id: string;
        components: Snapshot;
        computed_at: Date;
        previous: Snapshot | null;
      }>(
        `SELECT s.id, s.components, s.computed_at, p.components AS previous
           FROM reputation_snapshots s LEFT JOIN reputation_snapshots p ON p.id = s.previous_id
          WHERE s.user_id = $1 AND s.methodology_version = $2
          ORDER BY s.computed_at DESC, s.id DESC LIMIT 1`,
        [userId, ACTIVE_METHODOLOGY],
      )
    ).rows[0];
    if (!row) {
      const s = await this.rt.recompute(userId);
      row = { id: s.id, components: s.snapshot, computed_at: s.computedAt, previous: s.previous };
    }
    return {
      snapshotId: row.id,
      computedAt: row.computed_at.toISOString(),
      methodologyUrl: "/leaderboard/methodology",
      ...row.components,
      whatChanged: row.previous ? diffSnapshots(row.previous, row.components) : [],
    };
  }
}
