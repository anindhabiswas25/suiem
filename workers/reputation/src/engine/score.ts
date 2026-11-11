/**
 * The Suiem Score engine (PRD §10, ADR-0005): a pure, deterministic function
 * `score(evidence, methodology) → snapshot`. Same evidence + same methodology → byte-identical
 * canonical JSON. No I/O, no clock, no randomness, no floating point.
 *
 * Never counted (no field exists for them): $WIF balances or votes, post counts, AI report
 * counts, browsing time, follower counts, paid anything. The engine reads only the fields
 * declared in `Evidence`; anything else on the input object is ignored.
 */
import { clamp, div, formatPoints, formatPpm, HUNDRED, isqrt, POINT, PPM, weighted } from "./fixed";
import { type Methodology, NOT_A_RATING, PERFORMANCE_LABEL, BENCHMARK } from "./methodology";
import { jaccardPpm, shingles, textLength } from "./text";

// ---- Evidence (input) -------------------------------------------------------------------------

/** A closed (realized) trade from reconciled fills. Amounts are integer base units (6 dp). */
export interface ClosedTrade {
  id: string;
  book: "simulated" | "testnet";
  instrument: string;
  openedAt: string;
  closedAt: string;
  /** Cost basis removed by the sell, fees included (base units, 6 dp). */
  costUnits: string;
  /** Cash received by the sell, net of fees (base units, 6 dp). */
  proceedsUnits: string;
  /** SPY return over [openedAt, closedAt] in ppm, or null when no benchmark marks cover it. */
  benchmarkReturnPpm: string | null;
}

export interface OpenPosition {
  book: "simulated" | "testnet";
  instrument: string;
  costUnits: string;
}

export interface ThesisOutcome {
  id: string;
  thesisId: string;
  evaluatedAt: string;
  status: "evaluated" | "unevaluable";
  correct: boolean | null;
}

export interface ResearchItem {
  id: string;
  kind: "thesis" | "brief";
  createdAt: string;
  text: string;
  sourceCount: number;
  counterarguments: string;
  risks: string;
  invalidation: string;
  aiAssisted: boolean;
}

export interface CorpusText {
  id: string;
  authorId: string;
  createdAt: string;
  text: string;
}

export interface Rater {
  id: string;
  createdAt: string;
  /** When the rater first published research (thesis or brief post), or null if never. */
  researchSince: string | null;
  isDemo: boolean;
}

export interface Vote {
  targetId: string;
  /** What was voted on: a post kind, or an answer/comment. */
  target: "research" | "discussion" | "learning_note" | "answer" | "comment";
  raterId: string;
  kind: "helpful" | "not_helpful";
  createdAt: string;
}

export interface Evidence {
  subject: { userId: string; createdAt: string; isDemo: boolean };
  asOf: string;
  trades: ClosedTrade[];
  openPositions: OpenPosition[];
  thesisOutcomes: ThesisOutcome[];
  research: ResearchItem[];
  /** Earlier research texts by anyone (incl. the subject) for near-duplicate checks. */
  corpus: CorpusText[];
  votes: Vote[];
  raters: Rater[];
  /** Helpful votes the subject gave, by author (for reciprocal-ring detection). */
  helpfulGiven: { authorId: string; createdAt: string }[];
  /** Timestamps of the subject's own activity (trades, theses, posts, comments). */
  activity: string[];
}

// ---- Snapshot (output) ------------------------------------------------------------------------

export type ComponentKey =
  | "risk_adjusted_performance"
  | "thesis_outcome"
  | "consistency"
  | "risk_management"
  | "research_quality"
  | "helpful_feedback"
  | "educational"
  | "participation";

export interface ComponentResult {
  key: ComponentKey;
  label: string;
  weight: number;
  status: "scored" | "insufficient_data";
  /** 2-decimal string, or null when building / insufficient. */
  score: string | null;
  detail: Record<string, string | number | boolean | null>;
}

export interface Snapshot {
  methodologyVersion: string;
  asOf: string;
  maturity: "building" | "ranked";
  badge: string | null;
  performanceLabel: string;
  disclaimer: string;
  benchmark: string;
  suiemScore: string | null;
  investorScore: string | null;
  contributionScore: string | null;
  investor: ComponentResult[];
  contribution: ComponentResult[];
  progress: {
    decisions: { have: number; need: number };
    activeDays: { have: number; need: number };
    historyDays: { have: number; need: number };
    raters: { have: number; need: number };
  };
  evaluationPeriod: { from: string | null; to: string };
}

// ---- Helpers ----------------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const iso = (s: string) => new Date(s).toISOString();
const dayOf = (s: string) => iso(s).slice(0, 10);
const ms = (s: string) => new Date(s).getTime();
const byString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function scored(
  key: ComponentKey,
  label: string,
  weight: number,
  points: bigint | null,
  detail: ComponentResult["detail"],
): ComponentResult & { points: bigint } {
  return {
    key,
    label,
    weight,
    status: points === null ? "insufficient_data" : "scored",
    score: points === null ? null : formatPoints(points),
    detail,
    // Insufficient data scores zero: missing data is never treated as success (PRD §10.2).
    points: points ?? 0n,
  };
}

/** Saturating curve: 100 × x / (x + half), x and half in ppm-scaled units. */
function saturate(xPpm: bigint, halfPpm: bigint): bigint {
  if (xPpm <= 0n) return 0n;
  return div(HUNDRED * xPpm, xPpm + halfPpm);
}

// ---- Rater weighting (shared with feed ranking) ----------------------------------------------

export interface WeightedVote extends Vote {
  weightPpm: bigint;
  reasons: string[];
}

/**
 * Rater-diversity weighting (PRD §9.3, §10.3):
 * - each rater counts at most once per author per UTC day (the first vote that day);
 * - raters whose account was < 24h old at vote time, or with no research of their own, count
 *   at half weight (both: a quarter);
 * - reciprocal helpful rings (both directions ≥ threshold helpful votes) are discounted;
 * - demo accounts' votes count zero toward non-demo users; self-votes count zero.
 */
export function weighVotes(
  votes: Vote[],
  raters: Rater[],
  helpfulGiven: Evidence["helpfulGiven"],
  subject: Evidence["subject"],
  m: Methodology,
): WeightedVote[] {
  const raterById = new Map(raters.map((r) => [r.id, r]));
  const givenTo = new Map<string, number>();
  for (const g of helpfulGiven) givenTo.set(g.authorId, (givenTo.get(g.authorId) ?? 0) + 1);
  const receivedFrom = new Map<string, number>();
  for (const v of votes)
    if (v.kind === "helpful") receivedFrom.set(v.raterId, (receivedFrom.get(v.raterId) ?? 0) + 1);

  const sorted = [...votes].sort(
    (a, b) =>
      byString(iso(a.createdAt), iso(b.createdAt)) ||
      byString(a.raterId, b.raterId) ||
      byString(a.targetId, b.targetId),
  );
  const seenDay = new Set<string>();
  const c = m.contribution;
  return sorted.map((v) => {
    const reasons: string[] = [];
    let w = PPM;
    const r = raterById.get(v.raterId);
    const dayKey = `${v.raterId}|${dayOf(v.createdAt)}`;
    if (v.raterId === subject.userId) {
      w = 0n;
      reasons.push("self");
    } else if (!r) {
      w = 0n;
      reasons.push("unknown_rater");
    } else if (r.isDemo && !subject.isDemo) {
      w = 0n;
      reasons.push("demo_rater");
    } else if (seenDay.has(dayKey)) {
      w = 0n;
      reasons.push("same_day");
    } else {
      seenDay.add(dayKey);
      if (ms(v.createdAt) - ms(r.createdAt) < c.newAccountHours * 3_600_000) {
        w = div(w * c.newRaterWeightPpm, PPM);
        reasons.push("new_account");
      }
      if (r.researchSince === null || ms(r.researchSince) > ms(v.createdAt)) {
        w = div(w * c.noResearchRaterWeightPpm, PPM);
        reasons.push("no_research");
      }
      if (
        (givenTo.get(v.raterId) ?? 0) >= c.ringThreshold &&
        (receivedFrom.get(v.raterId) ?? 0) >= c.ringThreshold
      ) {
        w = div(w * c.ringWeightPpm, PPM);
        reasons.push("reciprocal_ring");
      }
    }
    return { ...v, weightPpm: w, reasons };
  });
}

function netWeighted(votes: WeightedVote[]): bigint {
  let net = 0n;
  for (const v of votes) net += v.kind === "helpful" ? v.weightPpm : -v.weightPpm;
  return net;
}

// ---- Investor components ------------------------------------------------------------------------

interface TradeReturn {
  id: string;
  closedAt: string;
  openedAt: string;
  returnPpm: bigint;
  excessPpm: bigint | null;
}

function tradeReturns(trades: ClosedTrade[]): TradeReturn[] {
  return [...trades]
    .filter((t) => BigInt(t.costUnits) > 0n)
    .sort((a, b) => byString(iso(a.closedAt), iso(b.closedAt)) || byString(a.id, b.id))
    .map((t) => {
      const cost = BigInt(t.costUnits);
      const r = div((BigInt(t.proceedsUnits) - cost) * PPM, cost);
      const b = t.benchmarkReturnPpm === null ? null : BigInt(t.benchmarkReturnPpm);
      return {
        id: t.id,
        closedAt: t.closedAt,
        openedAt: t.openedAt,
        returnPpm: r,
        excessPpm: b === null ? null : r - b,
      };
    });
}

/** Chain-linked (time-weighted) return of closed trades, in ppm. */
function chainLinkedPpm(returns: bigint[]): bigint {
  let equity = PPM;
  for (const r of returns) equity = div(equity * (PPM + r), PPM);
  return equity - PPM;
}

function riskAdjusted(trs: TradeReturn[], m: Methodology) {
  const withBench = trs.filter((t) => t.excessPpm !== null);
  const detail: ComponentResult["detail"] = {
    closedTrades: trs.length,
    tradesWithBenchmark: withBench.length,
    method: "chain-linked (time-weighted) return of closed trades vs SPY over each holding period",
    timeWeightedReturn: trs.length ? formatPpm(chainLinkedPpm(trs.map((t) => t.returnPpm))) : null,
  };
  const n = BigInt(withBench.length);
  const spanDays = withBench.length
    ? (Math.max(...withBench.map((t) => ms(t.closedAt))) -
        Math.min(...withBench.map((t) => ms(t.openedAt)))) /
      DAY_MS
    : 0;
  if (
    withBench.length < m.thresholds.minClosedTradesForRisk ||
    spanDays < m.thresholds.minRiskHistoryDays
  ) {
    detail.reason = `Needs ${m.thresholds.minClosedTradesForRisk} closed trades with a benchmark over at least ${m.thresholds.minRiskHistoryDays} day(s)`;
    return { points: null, detail };
  }
  const excess = withBench.map((t) => t.excessPpm!);
  const mean = div(
    excess.reduce((a, b) => a + b, 0n),
    n,
  );
  const variance = div(
    excess.reduce((a, e) => a + (e - mean) * (e - mean), 0n),
    n,
  ); // ppm²
  const stdev = isqrt(variance); // ppm
  const adjusted = mean - div(m.investor.volatilityPenaltyPpm * stdev, PPM);
  const points = clamp(50n * POINT + m.investor.excessPointsPerUnit * adjusted, 0n, HUNDRED);
  Object.assign(detail, {
    meanExcessReturn: formatPpm(mean),
    volatility: formatPpm(stdev),
    riskAdjustedExcess: formatPpm(adjusted),
  });
  return { points, detail };
}

function thesisOutcome(outcomes: ThesisOutcome[], m: Methodology) {
  const evaluated = outcomes.filter((o) => o.status === "evaluated" && o.correct !== null);
  const correct = evaluated.filter((o) => o.correct).length;
  const detail: ComponentResult["detail"] = {
    evaluated: evaluated.length,
    correct,
    unevaluable: outcomes.length - evaluated.length,
    priorStrength: m.investor.thesisPriorStrength,
  };
  if (!evaluated.length) {
    detail.reason = "No evaluated theses yet";
    return { points: null, detail };
  }
  // Bayesian shrinkage toward 50%: (correct + k/2) / (n + k).
  const k = BigInt(m.investor.thesisPriorStrength);
  const points = div(HUNDRED * (2n * BigInt(correct) + k), 2n * (BigInt(evaluated.length) + k));
  return { points, detail };
}

function consistency(trs: TradeReturn[], outcomes: ThesisOutcome[], m: Methodology) {
  const days = new Map<string, { pos: number; neg: number }>();
  const bump = (d: string, positive: boolean) => {
    const e = days.get(d) ?? { pos: 0, neg: 0 };
    if (positive) e.pos++;
    else e.neg++;
    days.set(d, e);
  };
  for (const t of trs) if (t.excessPpm !== null) bump(dayOf(t.closedAt), t.excessPpm > 0n);
  for (const o of outcomes)
    if (o.status === "evaluated" && o.correct !== null) bump(dayOf(o.evaluatedAt), o.correct);
  const total = days.size;
  const positive = [...days.values()].filter((d) => d.pos > d.neg).length;
  const detail: ComponentResult["detail"] = { evaluationDays: total, positiveDays: positive };
  if (total < m.thresholds.minActiveDays || total === 0) {
    detail.reason = `Needs at least ${Math.max(1, m.thresholds.minActiveDays)} daily evaluation periods`;
    return { points: null, detail };
  }
  return { points: div(HUNDRED * BigInt(positive), BigInt(total)), detail };
}

function riskManagement(trs: TradeReturn[], open: OpenPosition[], m: Methodology) {
  const detail: ComponentResult["detail"] = {};
  if (!trs.length && !open.length) {
    detail.reason = "No trades yet";
    return { points: null, detail };
  }
  // Max drawdown of the chain-linked equity curve of closed trades.
  let equity = PPM;
  let peak = PPM;
  let maxDd = 0n; // ppm
  for (const t of trs) {
    equity = div(equity * (PPM + t.returnPpm), PPM);
    if (equity > peak) peak = equity;
    const dd = peak > 0n ? div((peak - equity) * PPM, peak) : 0n;
    if (dd > maxDd) maxDd = dd;
  }
  // Largest single open position as a share of its own book (books are never summed).
  let maxShare = 0n; // ppm
  for (const book of ["simulated", "testnet"] as const) {
    const ps = open.filter((p) => p.book === book && BigInt(p.costUnits) > 0n);
    const total = ps.reduce((a, p) => a + BigInt(p.costUnits), 0n);
    for (const p of ps) {
      const s = div(BigInt(p.costUnits) * PPM, total);
      if (s > maxShare) maxShare = s;
    }
  }
  const ddPenalty = div(maxDd * 100n * m.investor.drawdownPenaltyPerPct, PPM);
  const limit = m.investor.concentrationLimitPct * 10_000n; // ppm
  const concPenalty =
    maxShare > limit
      ? div((maxShare - limit) * 100n * m.investor.concentrationPenaltyPerPct, PPM)
      : 0n;
  Object.assign(detail, {
    maxDrawdown: formatPpm(maxDd),
    largestPositionShare: formatPpm(maxShare),
  });
  return { points: clamp(HUNDRED - ddPenalty - concPenalty, 0n, HUNDRED), detail };
}

// ---- Contribution components ------------------------------------------------------------------

function researchQuality(e: Evidence, m: Methodology) {
  const c = m.contribution;
  const items = [...e.research].sort(
    (a, b) => byString(iso(a.createdAt), iso(b.createdAt)) || byString(a.id, b.id),
  );
  const detail: ComponentResult["detail"] = { items: items.length };
  if (!items.length) {
    detail.reason = "No published theses or research yet";
    return { points: null, detail, duplicates: 0 };
  }
  const corpus = [...e.corpus].map((t) => ({ ...t, sh: shingles(t.text, c.shingleSize) }));
  const own: { createdAt: string; sh: Set<string> }[] = [];
  let sum = 0n;
  let duplicates = 0;
  let originals = 0;
  for (const it of items) {
    const sh = shingles(it.text, c.shingleSize);
    const earlier = [
      ...corpus.filter((t) => t.id !== it.id && ms(t.createdAt) <= ms(it.createdAt)),
      ...own,
    ];
    own.push({ createdAt: it.createdAt, sh });
    if (earlier.some((t) => jaccardPpm(sh, t.sh) >= c.duplicateJaccardPpm)) {
      duplicates++;
      continue; // a near-duplicate earns zero (still counted in the average)
    }
    originals++;
    const filled = (s: string) => textLength(s) >= 20;
    const len = textLength(it.text);
    let pts = 0n;
    pts += it.sourceCount >= 2 ? 25n : it.sourceCount === 1 ? 15n : 0n;
    if (filled(it.counterarguments)) pts += 20n;
    if (filled(it.risks)) pts += 20n;
    if (filled(it.invalidation)) pts += 20n;
    if (len >= c.minLength && len <= c.maxLength) pts += 15n;
    let micro = pts * POINT;
    if (it.aiAssisted) micro = div(micro * c.aiAssistedWeightPpm, PPM);
    sum += micro;
  }
  const mean = div(sum, BigInt(items.length));
  const confidence = BigInt(Math.min(originals, c.fullConfidenceItems));
  const points = div(mean * confidence, BigInt(c.fullConfidenceItems));
  Object.assign(detail, { duplicates, originals, fullConfidenceAt: c.fullConfidenceItems });
  return { points, detail, duplicates };
}

// ---- Score ------------------------------------------------------------------------------------

export function score(e: Evidence, m: Methodology): Snapshot {
  const W = m.weights;
  const trs = tradeReturns(e.trades);

  const ra = riskAdjusted(trs, m);
  const to = thesisOutcome(e.thesisOutcomes, m);
  const co = consistency(trs, e.thesisOutcomes, m);
  const rm = riskManagement(trs, e.openPositions, m);
  const investor = [
    scored(
      "risk_adjusted_performance",
      "Risk-adjusted performance",
      W.investorParts.riskAdjusted,
      ra.points,
      ra.detail,
    ),
    scored("thesis_outcome", "Thesis outcome", W.investorParts.thesisOutcome, to.points, to.detail),
    scored("consistency", "Consistency", W.investorParts.consistency, co.points, co.detail),
    scored(
      "risk_management",
      "Risk management",
      W.investorParts.riskManagement,
      rm.points,
      rm.detail,
    ),
  ];

  const weightedVotes = weighVotes(e.votes, e.raters, e.helpfulGiven, e.subject, m);
  const half = m.contribution.helpfulHalfPoint * PPM;
  const fb = weightedVotes.filter((v) => v.target === "research" || v.target === "discussion");
  const edu = weightedVotes.filter((v) => v.target === "learning_note" || v.target === "answer");
  const cmt = weightedVotes.filter((v) => v.target === "comment" || v.target === "answer");
  const discounted = (reason: string) =>
    weightedVotes.filter((v) => v.reasons.includes(reason)).length;

  const rq = researchQuality(e, m);
  const fbNet = netWeighted(fb);
  const eduNet = netWeighted(edu);
  // Participation: comments with positive weighted helpful (capped) + distinct active days (capped).
  const byComment = new Map<string, bigint>();
  for (const v of cmt)
    byComment.set(
      v.targetId,
      (byComment.get(v.targetId) ?? 0n) + (v.kind === "helpful" ? v.weightPpm : -v.weightPpm),
    );
  const helpfulComments = [...byComment.values()].filter((x) => x > 0n).length;
  const activeDays = new Set(e.activity.map(dayOf)).size;
  const pc = m.contribution;
  const partPoints =
    div(
      60n * POINT * BigInt(Math.min(helpfulComments, pc.helpfulCommentsCap)),
      BigInt(pc.helpfulCommentsCap),
    ) + div(40n * POINT * BigInt(Math.min(activeDays, pc.activeDaysCap)), BigInt(pc.activeDaysCap));

  const contribution = [
    scored(
      "research_quality",
      "Research quality",
      W.contributionParts.researchQuality,
      rq.points,
      rq.detail,
    ),
    scored(
      "helpful_feedback",
      "Helpful feedback",
      W.contributionParts.helpfulFeedback,
      fb.length ? saturate(fbNet, half) : null,
      {
        votes: fb.length,
        weightedNetHelpful: formatPpm(fbNet),
        discountedRing: discounted("reciprocal_ring"),
        discountedNewAccount: discounted("new_account"),
        discountedNoResearch: discounted("no_research"),
        ignoredSameDay: discounted("same_day"),
        ignoredDemo: discounted("demo_rater"),
        ...(fb.length ? {} : { reason: "No helpful votes on your research yet" }),
      },
    ),
    scored(
      "educational",
      "Educational",
      W.contributionParts.educational,
      edu.length ? saturate(eduNet, half) : null,
      {
        votes: edu.length,
        weightedNetHelpful: formatPpm(eduNet),
        ...(edu.length ? {} : { reason: "No votes on learning notes or answers yet" }),
      },
    ),
    scored(
      "participation",
      "Participation",
      W.contributionParts.participation,
      activeDays ? clamp(partPoints, 0n, HUNDRED) : null,
      {
        helpfulComments,
        activeDays,
      },
    ),
  ];

  const investorMicro = weighted(investor.map((c) => ({ points: c.points, weight: c.weight })));
  const contributionMicro = weighted(
    contribution.map((c) => ({ points: c.points, weight: c.weight })),
  );
  const suiemMicro = weighted([
    { points: investorMicro, weight: W.investor },
    { points: contributionMicro, weight: W.contribution },
  ]);

  // Maturity (PRD §10.2): no score until the minimum history exists.
  const decisions =
    trs.length +
    e.thesisOutcomes.filter((o) => o.status === "evaluated" && o.correct !== null).length;
  const trustedRaters = new Set(
    weightedVotes.filter((v) => v.kind === "helpful" && v.weightPpm === PPM).map((v) => v.raterId),
  ).size;
  const historyDays = Math.max(0, Math.floor((ms(e.asOf) - ms(e.subject.createdAt)) / DAY_MS));
  const T = m.thresholds;
  const ranked =
    decisions >= T.minDecisions &&
    activeDays >= T.minActiveDays &&
    historyDays >= T.minHistoryDays &&
    trustedRaters >= T.minRaters;

  const hide = (c: (typeof investor)[number]): ComponentResult => ({
    key: c.key,
    label: c.label,
    weight: c.weight,
    status: c.status,
    score: ranked ? c.score : null,
    detail: c.detail,
  });
  const periodStart = [
    ...e.trades.map((t) => iso(t.openedAt)),
    ...e.thesisOutcomes.map((o) => iso(o.evaluatedAt)),
    ...e.activity.map(iso),
  ].sort(byString)[0];

  return {
    methodologyVersion: m.version,
    asOf: iso(e.asOf),
    maturity: ranked ? "ranked" : "building",
    badge: m.badge,
    performanceLabel: PERFORMANCE_LABEL,
    disclaimer: NOT_A_RATING,
    benchmark: BENCHMARK.label,
    suiemScore: ranked ? formatPoints(suiemMicro) : null,
    investorScore: ranked ? formatPoints(investorMicro) : null,
    contributionScore: ranked ? formatPoints(contributionMicro) : null,
    investor: investor.map(hide),
    contribution: contribution.map(hide),
    progress: {
      decisions: { have: decisions, need: T.minDecisions },
      activeDays: { have: activeDays, need: T.minActiveDays },
      historyDays: { have: historyDays, need: T.minHistoryDays },
      raters: { have: trustedRaters, need: T.minRaters },
    },
    evaluationPeriod: { from: periodStart ?? null, to: iso(e.asOf) },
  };
}

// ---- Canonical form, diff ---------------------------------------------------------------------

/** JSON with sorted keys: byte-identical for equal snapshots. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => byString(a, b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export interface Change {
  key: string;
  label: string;
  from: string | null;
  to: string | null;
}

/** "What changed" between two snapshots (totals, maturity and every component). */
export function diffSnapshots(prev: Snapshot | null, next: Snapshot): Change[] {
  const out: Change[] = [];
  const push = (key: string, label: string, a: string | null, b: string | null) => {
    if (a !== b) out.push({ key, label, from: a, to: b });
  };
  push("maturity", "Maturity", prev?.maturity ?? null, next.maturity);
  push("suiem_score", "Suiem Score", prev?.suiemScore ?? null, next.suiemScore);
  push("investor", "Investor performance", prev?.investorScore ?? null, next.investorScore);
  push(
    "contribution",
    "Community contribution",
    prev?.contributionScore ?? null,
    next.contributionScore,
  );
  for (const c of [...next.investor, ...next.contribution]) {
    const p = prev
      ? [...prev.investor, ...prev.contribution].find((x) => x.key === c.key)
      : undefined;
    push(c.key, c.label, p?.score ?? null, c.score);
  }
  push(
    "decisions",
    "Evaluated decisions",
    prev ? String(prev.progress.decisions.have) : null,
    String(next.progress.decisions.have),
  );
  push(
    "raters",
    "Trusted raters",
    prev ? String(prev.progress.raters.have) : null,
    String(next.progress.raters.have),
  );
  return out;
}

export const NEVER_COUNTED = [
  "$WIF balances or votes",
  "post counts",
  "AI report counts",
  "browsing time",
  "follower counts",
  "paid promotion or anything paid",
] as const;
