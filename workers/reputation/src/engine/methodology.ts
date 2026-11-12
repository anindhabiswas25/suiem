/**
 * Suiem Score methodologies (PRD §10, ADR-0005, OQ-P-07). Everything is an integer: weights
 * are percentages, ratios are parts per million (ppm, 1.0 = 1_000_000) and points are
 * micro-points (1 point = 1_000_000). Switching the active methodology is one config change
 * (`ACTIVE_METHODOLOGY`).
 */

export type MethodologyVersion = "v1-hackathon" | "v1";

export interface Methodology {
  version: MethodologyVersion;
  name: string;
  /** Shown on every score computed with this methodology (null for production). */
  badge: string | null;
  thresholds: {
    /** Closed/realized trades (simulated + testnet demo) plus evaluated theses. */
    minDecisions: number;
    /** Distinct UTC days with activity (trades, theses, posts, comments). */
    minActiveDays: number;
    /** Days since the account was created. */
    minHistoryDays: number;
    /** Distinct trusted raters (full weight) who marked the user's work helpful. */
    minRaters: number;
    /** Closed trades with a benchmark before risk-adjusted performance is used. */
    minClosedTradesForRisk: number;
    /** Days between the first opening and the last closing trade for risk-adjusted performance. */
    minRiskHistoryDays: number;
  };
  weights: {
    investor: number;
    contribution: number;
    investorParts: {
      riskAdjusted: number;
      thesisOutcome: number;
      consistency: number;
      riskManagement: number;
    };
    contributionParts: {
      researchQuality: number;
      helpfulFeedback: number;
      educational: number;
      participation: number;
    };
  };
  investor: {
    /** Bayesian prior: this many pseudo-evaluations at 50% correct. */
    thesisPriorStrength: number;
    /** Neutral theses are correct when |relative return| is within this band (ppm). */
    neutralBandPpm: bigint;
    /** Points per 1.0 of risk-adjusted mean excess return, added to a 50-point midpoint. */
    excessPointsPerUnit: bigint;
    /** Volatility penalty: adjusted = mean excess − k × stdev (k in ppm). */
    volatilityPenaltyPpm: bigint;
    /** Risk management: points lost per 1% of max drawdown (micro-points). */
    drawdownPenaltyPerPct: bigint;
    /** Points lost per 1% of single-position concentration above the limit. */
    concentrationPenaltyPerPct: bigint;
    concentrationLimitPct: bigint;
  };
  contribution: {
    /** Weighted net helpful votes at which the helpful score reaches 50 points. */
    helpfulHalfPoint: bigint;
    newAccountHours: number;
    /** Weight of a rater whose account is < newAccountHours old at vote time (ppm). */
    newRaterWeightPpm: bigint;
    /** Weight of a rater with no research of their own (ppm). Multiplies with the above. */
    noResearchRaterWeightPpm: bigint;
    /** Reciprocal ring: both directions have at least this many helpful votes. */
    ringThreshold: number;
    ringWeightPpm: bigint;
    /** Research length bounds (characters, after normalising whitespace). */
    minLength: number;
    maxLength: number;
    /** Word-shingle size and the Jaccard similarity at which text counts as a near-duplicate. */
    shingleSize: number;
    duplicateJaccardPpm: bigint;
    /** Research items needed for full confidence in the average quality. */
    fullConfidenceItems: number;
    /** AI-assisted research counts at this weight (not proof of expertise, PRD §10.4). */
    aiAssistedWeightPpm: bigint;
    helpfulCommentsCap: number;
    activeDaysCap: number;
  };
}

const WEIGHTS: Methodology["weights"] = {
  investor: 50,
  contribution: 50,
  investorParts: { riskAdjusted: 40, thesisOutcome: 30, consistency: 20, riskManagement: 10 },
  contributionParts: {
    researchQuality: 40,
    helpfulFeedback: 30,
    educational: 20,
    participation: 10,
  },
};

const COMMON = {
  investor: {
    neutralBandPpm: 20_000n, // ±2%
    excessPointsPerUnit: 250n, // +20% risk-adjusted mean excess → 100 points
    volatilityPenaltyPpm: 500_000n, // k = 0.5
    drawdownPenaltyPerPct: 2_000_000n, // 2 points per 1% drawdown
    concentrationPenaltyPerPct: 1_000_000n, // 1 point per 1% above the limit
    concentrationLimitPct: 50n,
  },
  contribution: {
    newAccountHours: 24,
    newRaterWeightPpm: 500_000n,
    noResearchRaterWeightPpm: 500_000n,
    ringThreshold: 3,
    ringWeightPpm: 250_000n,
    minLength: 200,
    maxLength: 8_000,
    shingleSize: 5,
    duplicateJaccardPpm: 800_000n,
    aiAssistedWeightPpm: 500_000n,
    helpfulCommentsCap: 5,
    activeDaysCap: 7,
  },
};

/** Hackathon season (PO decision OQ-P-07): relaxed thresholds, always badged as a preview. */
export const V1_HACKATHON: Methodology = {
  version: "v1-hackathon",
  name: "Suiem Score v1 (Season 1)",
  badge: "Season 1 · limited history · preview",
  thresholds: {
    minDecisions: 5,
    minActiveDays: 3,
    minHistoryDays: 0,
    minRaters: 3,
    minClosedTradesForRisk: 3,
    minRiskHistoryDays: 1,
  },
  weights: WEIGHTS,
  investor: { ...COMMON.investor, thesisPriorStrength: 4 },
  contribution: { ...COMMON.contribution, helpfulHalfPoint: 5n, fullConfidenceItems: 3 },
};

/** Production thresholds (PRD §10.2, ADR-0005): ≥ 90 days and ≥ 10 evaluated decisions. */
export const V1: Methodology = {
  version: "v1",
  name: "Suiem Score v1",
  badge: null,
  thresholds: {
    minDecisions: 10,
    minActiveDays: 10,
    minHistoryDays: 90,
    minRaters: 3,
    minClosedTradesForRisk: 10,
    minRiskHistoryDays: 30,
  },
  weights: WEIGHTS,
  investor: { ...COMMON.investor, thesisPriorStrength: 10 },
  contribution: { ...COMMON.contribution, helpfulHalfPoint: 10n, fullConfidenceItems: 10 },
};

export const METHODOLOGIES: Record<MethodologyVersion, Methodology> = {
  "v1-hackathon": V1_HACKATHON,
  v1: V1,
};

/** The one config switch between the hackathon season and production thresholds. */
export const ACTIVE_METHODOLOGY: MethodologyVersion = "v1-hackathon";

export const BENCHMARK = {
  symbol: "SPY",
  label: "SPDR S&P 500 ETF (SPY), Finnhub quote",
  reason:
    "SPY is a broad, liquid proxy for the US large-cap market. Every Suiem instrument is a US large-cap company.",
} as const;

export const PERFORMANCE_LABEL = "Simulated / testnet performance, not live verified";
export const NOT_A_RATING =
  "The Suiem Score is not a prediction of future returns and not a financial rating.";
