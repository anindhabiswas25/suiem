/**
 * Discover ranking (PRD §9.1): recency decay + rater-weighted helpful score + trending
 * companies, with a diversity cap of 2 posts per author per page. Deterministic for a given
 * `asOf` (only reactions up to `asOf` count), so cursor pages are stable.
 */
import { V1_HACKATHON, weighVotes, type Rater, type Vote } from "@suiem/reputation";

export const PAGE_SIZE = 20;
export const AUTHOR_CAP = 2;
const HALF_LIFE_HOURS = 24;

export interface Candidate {
  id: string;
  authorId: string;
  authorIsDemo: boolean;
  entityId: string | null;
  createdAt: Date;
}

export interface RankInput {
  candidates: Candidate[];
  votes: (Vote & { postId: string })[];
  raters: Rater[];
  /** entity id → research/thesis/post activity in the last 24h. */
  trending: Map<string, number>;
  asOf: Date;
}

/** Ranked pages: each holds at most PAGE_SIZE posts and AUTHOR_CAP posts per author. */
export function rank(input: RankInput): string[][] {
  const maxTrend = Math.max(1, ...input.trending.values());
  const scored = input.candidates.map((c) => {
    const ageHours = Math.max(0, (input.asOf.getTime() - c.createdAt.getTime()) / 3_600_000);
    const recency = 2 ** (-ageHours / HALF_LIFE_HOURS);
    const votes = input.votes.filter((v) => v.postId === c.id);
    const weighted = weighVotes(
      votes,
      input.raters,
      [],
      { userId: c.authorId, createdAt: c.createdAt.toISOString(), isDemo: c.authorIsDemo },
      V1_HACKATHON,
    );
    let net = 0;
    for (const v of weighted) net += ((v.kind === "helpful" ? 1 : -1) * Number(v.weightPpm)) / 1e6;
    const helpful = Math.log1p(Math.max(0, net)) * 0.35;
    const trend = c.entityId ? (0.3 * (input.trending.get(c.entityId) ?? 0)) / maxTrend : 0;
    return { c, s: recency + helpful + trend };
  });
  scored.sort(
    (a, b) =>
      b.s - a.s ||
      b.c.createdAt.getTime() - a.c.createdAt.getTime() ||
      (a.c.id < b.c.id ? 1 : a.c.id > b.c.id ? -1 : 0),
  );
  // Diversity: fill each page with at most AUTHOR_CAP posts per author; overflow moves on.
  let rest = scored.map((x) => x.c);
  const pages: string[][] = [];
  while (rest.length) {
    const page: Candidate[] = [];
    const perAuthor = new Map<string, number>();
    const next: Candidate[] = [];
    for (const c of rest) {
      const n = perAuthor.get(c.authorId) ?? 0;
      if (page.length < PAGE_SIZE && n < AUTHOR_CAP) {
        page.push(c);
        perAuthor.set(c.authorId, n + 1);
      } else next.push(c);
    }
    pages.push(page.map((c) => c.id));
    rest = next;
  }
  return pages;
}

export function encodeCursor(c: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeCursor<T>(s: string | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(Buffer.from(s, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}
