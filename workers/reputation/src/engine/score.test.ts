import fc from "fast-check";
import { describe, expect, test } from "vitest";
import { evaluateThesis, returnPpm } from "./evaluate";
import { formatPoints } from "./fixed";
import { V1, V1_HACKATHON } from "./methodology";
import {
  canonicalJson,
  diffSnapshots,
  type Evidence,
  type ResearchItem,
  type Snapshot,
  score,
  type Vote,
} from "./score";

const M = V1_HACKATHON;
const SUBJECT = "00000000-0000-7000-8000-000000000001";
const day = (d: number, h = 12) =>
  `2026-11-${String(d).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;

/** Distinct, realistic-length research text (no two seeds share 5-word shingles). */
const WORDS =
  "alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu".split(
    " ",
  );
function text(seed: number, words = 60): string {
  const out: string[] = [];
  for (let i = 0; i < words; i++)
    out.push(`${WORDS[(seed * 7 + i * 3) % WORDS.length]}${seed}x${i}`);
  return out.join(" ");
}
const LONG = "Margins could compress if competitors cut prices faster than expected.";

function research(
  id: string,
  d: number,
  sources: number,
  opts: Partial<ResearchItem> = {},
): ResearchItem {
  return {
    id,
    kind: "thesis",
    createdAt: day(d),
    text: text(Number(id.replace(/\D/g, "")) || d),
    sourceCount: sources,
    counterarguments: LONG,
    risks: LONG,
    invalidation: LONG,
    aiAssisted: false,
    ...opts,
  };
}

const trusted = (i: number) => ({
  id: `rater-${i}`,
  createdAt: "2026-01-01T00:00:00.000Z",
  hasResearch: true,
  isDemo: false,
});

function empty(): Evidence {
  return {
    subject: { userId: SUBJECT, createdAt: "2026-11-01T00:00:00.000Z", isDemo: false },
    asOf: "2026-11-11T12:00:00.000Z",
    trades: [],
    openPositions: [],
    thesisOutcomes: [],
    research: [],
    corpus: [],
    votes: [],
    raters: [],
    helpfulGiven: [],
    activity: [],
  };
}

/**
 * Worked example (also in docs/REPUTATION_METHODOLOGY.md):
 *
 * Investor
 * - Risk-adjusted: 3 closed trades, each +5% vs SPY +1% → excess +4% each, stdev 0.
 *   50 + 250 × 0.04 = 60.00
 * - Thesis outcome: 4 evaluated, 3 correct, prior k = 4 → (3 + 2) / (4 + 4) = 62.50
 * - Consistency: 5 evaluation days (3 trade days, 2 thesis days; one thesis day is 1 right
 *   1 wrong, so not positive) → 4 / 5 = 80.00
 * - Risk management: no drawdown; largest open position 60% of its book → 100 − (60 − 50) = 90.00
 *   Investor = 0.4×60 + 0.3×62.5 + 0.2×80 + 0.1×90 = 24 + 18.75 + 16 + 9 = 67.75
 *
 * Contribution
 * - Research quality: 3 original items scoring 100, 90 and 80 (full confidence at 3) → 90.00
 * - Helpful feedback: 5 trusted raters, one helpful each → net 5, 100 × 5 / (5 + 5) = 50.00
 * - Educational: the same 5 raters mark a learning note helpful on another day → 50.00
 * - Participation: 2 comments with helpful votes → 60 × 2/5 = 24; 7 active days → 40 → 64.00
 *   Contribution = 0.4×90 + 0.3×50 + 0.2×50 + 0.1×64 = 36 + 15 + 10 + 6.4 = 67.40
 *
 * Suiem Score = 0.5 × 67.75 + 0.5 × 67.40 = 67.575 → 67.58 (half-even to 2 decimals)
 */
function worked(): Evidence {
  const e = empty();
  e.trades = [3, 4, 5].map((d, i) => ({
    id: `trade-${i}`,
    book: "simulated" as const,
    instrument: "SIM:NVDA",
    openedAt: day(d - 1),
    closedAt: day(d),
    costUnits: "100000000",
    proceedsUnits: "105000000",
    benchmarkReturnPpm: "10000",
  }));
  e.openPositions = [
    { book: "simulated", instrument: "SIM:AAPL", costUnits: "60000000" },
    { book: "simulated", instrument: "SIM:MSFT", costUnits: "40000000" },
  ];
  e.thesisOutcomes = [
    { id: "ev1", thesisId: "t1", evaluatedAt: day(6), status: "evaluated", correct: true },
    { id: "ev2", thesisId: "t2", evaluatedAt: day(6, 13), status: "evaluated", correct: true },
    { id: "ev3", thesisId: "t3", evaluatedAt: day(7), status: "evaluated", correct: true },
    { id: "ev4", thesisId: "t4", evaluatedAt: day(7, 13), status: "evaluated", correct: false },
  ];
  e.research = [
    research("r1", 2, 2), // 25 + 20 + 20 + 20 + 15 = 100
    research("r2", 3, 1), // 15 + 20 + 20 + 20 + 15 = 90
    research("r3", 4, 2, { invalidation: "" }), // 25 + 20 + 20 + 0 + 15 = 80
  ];
  e.raters = [1, 2, 3, 4, 5].map(trusted);
  const v = (i: number, target: Vote["target"], targetId: string, d: number): Vote => ({
    targetId,
    target,
    raterId: `rater-${i}`,
    kind: "helpful",
    createdAt: day(d),
  });
  e.votes = [
    ...[1, 2, 3, 4, 5].map((i) => v(i, "research", "post-1", 8)),
    ...[1, 2, 3, 4, 5].map((i) => v(i, "learning_note", "post-2", 9)),
    v(1, "comment", "c-1", 10),
    v(2, "comment", "c-2", 10),
  ];
  e.activity = [2, 3, 4, 5, 6, 7, 8].map((d) => day(d, 9));
  return e;
}

const comp = (s: Snapshot, key: string) =>
  [...s.investor, ...s.contribution].find((c) => c.key === key)!;

describe("weights: the 50/50 and sub-weights are exact on the worked example", () => {
  test("every component, both halves and the total", () => {
    const s = score(worked(), M);
    expect(s.maturity).toBe("ranked");
    expect(comp(s, "risk_adjusted_performance").score).toBe("60.00");
    expect(comp(s, "thesis_outcome").score).toBe("62.50");
    expect(comp(s, "consistency").score).toBe("80.00");
    expect(comp(s, "risk_management").score).toBe("90.00");
    expect(s.investorScore).toBe("67.75");
    expect(comp(s, "research_quality").score).toBe("90.00");
    expect(comp(s, "helpful_feedback").score).toBe("50.00");
    expect(comp(s, "educational").score).toBe("50.00");
    expect(comp(s, "participation").score).toBe("64.00");
    expect(s.contributionScore).toBe("67.40");
    expect(s.suiemScore).toBe("67.58");
    expect(s.investor.map((c) => c.weight)).toEqual([40, 30, 20, 10]);
    expect(s.contribution.map((c) => c.weight)).toEqual([40, 30, 20, 10]);
    expect(s.badge).toBe("Hackathon season · limited history · preview");
    expect(s.performanceLabel).toBe("Simulated / testnet performance, not live verified");
  });
  test("rounding is half-even on the decimal library", () => {
    expect(formatPoints(67_565_000n)).toBe("67.56");
    expect(formatPoints(67_575_000n)).toBe("67.58");
    expect(formatPoints(67_574_999n)).toBe("67.57");
  });
  test("production v1 thresholds keep the same evidence building (one config switch)", () => {
    const s = score(worked(), V1);
    expect(s.maturity).toBe("building");
    expect(s.progress.decisions.need).toBe(10);
    expect(s.progress.historyDays.need).toBe(90);
  });
});

describe("reproducibility", () => {
  test("same evidence + version → byte-identical snapshots", () => {
    expect(canonicalJson(score(worked(), M))).toBe(canonicalJson(score(worked(), M)));
  });
  test("input order does not matter", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1_000_000 }), (seed) => {
        const e = worked();
        const shuffle = <T>(a: T[]) =>
          a
            .map((x, i) => ({ x, k: (i * 7919 + seed) % 104729 }))
            .sort((p, q) => p.k - q.k)
            .map((p) => p.x);
        const s = {
          ...e,
          trades: shuffle(e.trades),
          votes: shuffle(e.votes),
          research: shuffle(e.research),
          activity: shuffle(e.activity),
          thesisOutcomes: shuffle(e.thesisOutcomes),
          raters: shuffle(e.raters),
          openPositions: shuffle(e.openPositions),
        };
        expect(canonicalJson(score(s, M))).toBe(canonicalJson(score(e, M)));
      }),
      { numRuns: 50 },
    );
  });
});

describe("never counted: $WIF, post counts, AI reports, followers, browsing", () => {
  test("property: arbitrary values for these inputs change nothing", () => {
    const base = canonicalJson(score(worked(), M));
    fc.assert(
      fc.property(
        fc.record({
          wifBalance: fc.bigInt({ min: 0n, max: 10n ** 30n }).map(String),
          wifVotesCast: fc.nat(),
          wifVotesReceived: fc.nat(),
          postCount: fc.nat(),
          aiReportCount: fc.nat(),
          followerCount: fc.nat(),
          browsingMinutes: fc.nat(),
          paidPromotion: fc.boolean(),
        }),
        fc.integer({ min: 1, max: 50 }),
        (extra, morePosts) => {
          const e = worked();
          // More posts on days that were already active: post COUNT is not a signal.
          const activity = [
            ...e.activity,
            ...Array.from({ length: morePosts }, (_, i) => day(2 + (i % 7), 10)),
          ];
          const withExtra = {
            ...e,
            ...extra,
            activity,
            subject: { ...e.subject, ...extra },
          } as Evidence;
          expect(canonicalJson(score(withExtra, M))).toBe(base);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe("one lucky trade", () => {
  test("a single huge winning trade can't produce a ranked profile", () => {
    const e = empty();
    e.trades = [
      {
        id: "x",
        book: "testnet",
        instrument: "DEMO:TSLA",
        openedAt: day(2),
        closedAt: day(3),
        costUnits: "1000000",
        proceedsUnits: "50000000",
        benchmarkReturnPpm: "0",
      },
    ];
    e.raters = [1, 2, 3].map(trusted);
    e.votes = [1, 2, 3].map((i) => ({
      targetId: "p",
      target: "research" as const,
      raterId: `rater-${i}`,
      kind: "helpful" as const,
      createdAt: day(4),
    }));
    e.activity = [day(2), day(3), day(4)];
    const s = score(e, M);
    expect(s.maturity).toBe("building");
    expect(s.suiemScore).toBeNull();
    expect(comp(s, "risk_adjusted_performance").status).toBe("insufficient_data");
  });
  test("one lucky thesis can't max the thesis component (Bayesian prior)", () => {
    const e = worked();
    e.thesisOutcomes = [
      { id: "a", thesisId: "t", evaluatedAt: day(6), status: "evaluated", correct: true },
    ];
    e.trades.push(...[6, 7].map((d) => ({ ...e.trades[0]!, id: `t${d}`, closedAt: day(d) })));
    const s = score(e, M);
    expect(s.maturity).toBe("ranked");
    expect(comp(s, "thesis_outcome").score).toBe("60.00"); // (1 + 2) / (1 + 4)
    const many = worked();
    many.thesisOutcomes = Array.from({ length: 40 }, (_, i) => ({
      id: `e${i}`,
      thesisId: `t${i}`,
      evaluatedAt: day(6),
      status: "evaluated" as const,
      correct: true,
    }));
    expect(Number(comp(score(many, M), "thesis_outcome").score)).toBeGreaterThan(95);
  });
});

describe("missing or unverifiable data never increases the score", () => {
  const micro = (s: Snapshot) => s.suiemScore;
  test("insufficient components score zero, not a neutral midpoint", () => {
    const e = worked();
    e.thesisOutcomes = [];
    e.trades.push(
      ...[6, 7].map((d) => ({
        ...e.trades[0]!,
        id: `t${d}`,
        openedAt: day(d - 1),
        closedAt: day(d),
      })),
    );
    const s = score(e, V1_HACKATHON);
    expect(s.maturity).toBe("ranked");
    expect(comp(s, "thesis_outcome").status).toBe("insufficient_data");
    // 0.4×60 + 0.3×0 + 0.2×(5/5 trade days positive = 100) + 0.1×90 = 53
    expect(s.investorScore).toBe("53.00");
  });
  test("unevaluable theses add nothing", () => {
    const base = score(worked(), M);
    const e = worked();
    e.thesisOutcomes.push(
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `u${i}`,
        thesisId: `u${i}`,
        evaluatedAt: day(8),
        status: "unevaluable" as const,
        correct: null,
      })),
    );
    const s = score(e, M);
    expect(micro(s)).toBe(micro(base));
    expect(s.progress.decisions.have).toBe(base.progress.decisions.have);
  });
  test("trades without a benchmark never earn risk-adjusted credit", () => {
    const e = worked();
    e.trades = e.trades.map((t) => ({
      ...t,
      benchmarkReturnPpm: null,
      proceedsUnits: "190000000",
    }));
    const s = score(e, M);
    expect(comp(s, "risk_adjusted_performance").status).toBe("insufficient_data");
    expect(Number(s.investorScore)).toBeLessThan(Number(score(worked(), M).investorScore));
  });
  test("property: adding unevaluable outcomes or zero-cost (unverifiable) trades never raises the score", () => {
    fc.assert(
      fc.property(fc.nat({ max: 8 }), fc.nat({ max: 8 }), (u, z) => {
        const e = worked();
        e.thesisOutcomes.push(
          ...Array.from({ length: u }, (_, i) => ({
            id: `u${i}`,
            thesisId: `u${i}`,
            evaluatedAt: day(9),
            status: "unevaluable" as const,
            correct: null,
          })),
        );
        e.trades.push(
          ...Array.from({ length: z }, (_, i) => ({
            ...e.trades[0]!,
            id: `z${i}`,
            costUnits: "0",
            proceedsUnits: "999000000",
          })),
        );
        expect(Number(score(e, M).suiemScore)).toBeLessThanOrEqual(
          Number(score(worked(), M).suiemScore),
        );
      }),
    );
  });
  test("research without sources scores lower than the same research with sources", () => {
    const a = worked();
    const b = worked();
    b.research = b.research.map((r) => ({ ...r, sourceCount: 0 }));
    expect(Number(comp(score(b, M), "research_quality").score)).toBeLessThan(
      Number(comp(score(a, M), "research_quality").score),
    );
  });
});

describe("rings and sockpuppets are discounted", () => {
  const helpful = (rater: string, d: number): Vote => ({
    targetId: `p-${d}`,
    target: "research",
    raterId: rater,
    kind: "helpful",
    createdAt: day(d),
  });
  test("reciprocal helpful ring (A↔B above the threshold)", () => {
    const honest = worked();
    honest.votes = [1, 2, 3].flatMap((i) => [2, 3, 4].map((d) => helpful(`rater-${i}`, d)));
    const ring = worked();
    ring.votes = honest.votes;
    ring.helpfulGiven = [1, 2, 3].flatMap((i) =>
      [2, 3, 4].map((d) => ({ authorId: `rater-${i}`, createdAt: day(d) })),
    );
    const h = comp(score(honest, M), "helpful_feedback");
    const r = comp(score(ring, M), "helpful_feedback");
    expect(Number(r.score)).toBeLessThan(Number(h.score));
    expect(r.detail.discountedRing).toBe(9);
    // Ring raters are not trusted raters, so the ring alone can't rank anyone.
    expect(score(ring, M).progress.raters.have).toBe(0);
  });
  test("sockpuppet ring: new accounts with no research", () => {
    const honest = worked();
    honest.raters = Array.from({ length: 8 }, (_, i) => trusted(i));
    honest.votes = honest.raters.map((r) => helpful(r.id, 8));
    const puppets = worked();
    puppets.raters = Array.from({ length: 8 }, (_, i) => ({
      id: `rater-${i}`,
      createdAt: day(8, 6),
      hasResearch: false,
      isDemo: false,
    }));
    puppets.votes = honest.votes;
    const p = score(puppets, M);
    expect(Number(comp(p, "helpful_feedback").score)).toBeLessThan(
      Number(comp(score(honest, M), "helpful_feedback").score),
    );
    expect(comp(p, "helpful_feedback").detail.weightedNetHelpful).toBe("2.000000"); // 8 × ¼
    expect(p.progress.raters.have).toBe(0);
    expect(p.maturity).toBe("building");
  });
  test("a rater counts once per author per day; demo raters count zero for non-demo users", () => {
    const e = worked();
    e.raters.push({
      id: "demo-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      hasResearch: true,
      isDemo: true,
    });
    e.votes = [
      helpful("rater-1", 8),
      { ...helpful("rater-1", 8), targetId: "p-other" },
      helpful("demo-1", 8),
    ];
    const fb = comp(score(e, M), "helpful_feedback");
    expect(fb.detail.weightedNetHelpful).toBe("1.000000");
    expect(fb.detail.ignoredSameDay).toBe(1);
    expect(fb.detail.ignoredDemo).toBe(1);
  });
});

describe("duplicates earn zero quality", () => {
  test("near-duplicate of someone else's earlier post", () => {
    const e = worked();
    e.corpus = [
      {
        id: "other",
        authorId: "someone",
        createdAt: day(1),
        text: e.research[0]!.text.replace("alpha", "ALPHA!"),
      },
    ];
    const rq = comp(score(e, M), "research_quality");
    expect(rq.detail.duplicates).toBe(1);
    // (0 + 90 + 80) / 3 × (2 originals / 3) = 37.78
    expect(rq.score).toBe("37.78");
  });
  test("near-duplicate of the user's own earlier research", () => {
    const e = worked();
    e.research.push({
      ...e.research[0]!,
      id: "r9",
      createdAt: day(9),
      text: `${e.research[0]!.text} extra`,
    });
    expect(comp(score(e, M), "research_quality").detail.duplicates).toBe(1);
  });
});

describe("building state", () => {
  test("building stores no score anywhere", () => {
    const s = score(empty(), M);
    expect(s.maturity).toBe("building");
    expect([s.suiemScore, s.investorScore, s.contributionScore]).toEqual([null, null, null]);
    expect([...s.investor, ...s.contribution].every((c) => c.score === null)).toBe(true);
    expect(s.progress.decisions).toEqual({ have: 0, need: 5 });
  });
});

describe("what changed", () => {
  test("diff lists maturity and component moves", () => {
    const a = score(empty(), M);
    const b = score(worked(), M);
    const d = diffSnapshots(a, b);
    expect(d.find((c) => c.key === "maturity")).toEqual({
      key: "maturity",
      label: "Maturity",
      from: "building",
      to: "ranked",
    });
    expect(d.find((c) => c.key === "suiem_score")?.to).toBe("67.58");
    expect(diffSnapshots(b, b)).toEqual([]);
  });
});

describe("thesis evaluation (pure)", () => {
  test("benchmark-relative direction", () => {
    // Instrument +10%, SPY +4% → relative +6%.
    const r = evaluateThesis({
      direction: "bullish",
      startPrice: "100",
      endPrice: "110",
      benchmarkStart: "500",
      benchmarkEnd: "520",
      neutralBandPpm: 20_000n,
    });
    expect(r).toEqual({
      status: "evaluated",
      instrumentReturnPpm: 100_000n,
      benchmarkReturnPpm: 40_000n,
      relativeReturnPpm: 60_000n,
      correct: true,
    });
    // Up in absolute terms, but behind SPY: a bullish call is wrong, a bearish call is right.
    const behind = {
      startPrice: "100",
      endPrice: "102",
      benchmarkStart: "500",
      benchmarkEnd: "520",
      neutralBandPpm: 20_000n,
    };
    expect(evaluateThesis({ direction: "bullish", ...behind })).toMatchObject({ correct: false });
    expect(evaluateThesis({ direction: "bearish", ...behind })).toMatchObject({ correct: true });
    expect(evaluateThesis({ direction: "neutral", ...behind })).toMatchObject({ correct: true }); // |−2%| ≤ 2%
  });
  test("missing prices are unevaluable, never correct", () => {
    expect(
      evaluateThesis({
        direction: "bullish",
        startPrice: null,
        endPrice: "1",
        benchmarkStart: "1",
        benchmarkEnd: "1",
        neutralBandPpm: 0n,
      }).status,
    ).toBe("unevaluable");
    expect(
      evaluateThesis({
        direction: "bullish",
        startPrice: "1",
        endPrice: "1",
        benchmarkStart: null,
        benchmarkEnd: "1",
        neutralBandPpm: 0n,
      }).status,
    ).toBe("unevaluable");
  });
  test("returns are exact integers", () => {
    expect(returnPpm("379.78", "380.16")).toBe(1_001n);
  });
});
