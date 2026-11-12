import { z } from "zod";
import { CONSENT_PURPOSES, consentEventSchema } from "../consent";
import { FEATURE_FLAGS, JURISDICTION_RE } from "../policy";

/** API DTOs for /api/v1, shared by apps/api (validation + OpenAPI) and apps/web (typed client). */

export const SUIEM_SIWE_CHAIN_IDS = [4663, 46630] as const;

// ---- Auth: passkey + SIWE (ADR-0010 §4) ---------------------------------------------------
export const authMethodSchema = z.enum(["passkey", "siwe"]);
export type AuthMethodKind = z.infer<typeof authMethodSchema>;

export const csrfResponse = z.object({ csrfToken: z.string() });

export const sessionResponse = z.object({
  userId: z.uuid(),
  authMethods: z.array(authMethodSchema),
  isNewUser: z.boolean(),
});

/** WebAuthn payloads are validated structurally here; @simplewebauthn verifies them. */
export const passkeyOptionsResponse = z.object({ options: z.record(z.string(), z.unknown()) });
export const passkeyVerifyRequest = z
  .object({ response: z.record(z.string(), z.unknown()) })
  .strict();

export const siweNonceRequest = z
  .object({ chainId: z.union([z.literal(4663), z.literal(46630)]) })
  .strict();
export const siweNonceResponse = z.object({
  nonce: z.string(),
  issuedAt: z.string(),
  expirationTime: z.string(),
  chainId: z.union([z.literal(4663), z.literal(46630)]),
  domain: z.string(),
  uri: z.string(),
  statement: z.string(),
});
export const siweVerifyRequest = z
  .object({
    message: z.string().min(50).max(2000),
    signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
  })
  .strict();
export const walletLinkRequest = siweVerifyRequest
  .extend({ custodyAcknowledged: z.literal(true) })
  .strict();

export const walletAccount = z.object({
  id: z.uuid(),
  chainId: z.number().int(),
  address: z.string(),
  linkedAt: z.string(),
});
export const walletListResponse = z.object({ items: z.array(walletAccount) });

// ---- Me / onboarding ----------------------------------------------------------------------
export const INTERESTS = [
  "technology",
  "healthcare",
  "energy",
  "finance",
  "ai",
  "consumer",
  "industrials",
  "real_estate",
  "crypto",
  "education",
] as const;
export const EXPERIENCE_LEVELS = ["beginner", "intermediate", "experienced"] as const;
export const RESEARCH_DEPTHS = ["plain_language", "balanced", "detailed"] as const;

export const meResponse = z.object({
  id: z.uuid(),
  handle: z.string(),
  displayName: z.string().nullable(),
  jurisdiction: z.string().nullable(),
  experienceLevel: z.enum(EXPERIENCE_LEVELS).nullable(),
  researchDepth: z.enum(RESEARCH_DEPTHS).nullable(),
  interests: z.array(z.enum(INTERESTS)),
  interestsSkipped: z.boolean(),
  onboardingCompletedAt: z.string().nullable(),
  authMethods: z.array(authMethodSchema),
  passkeyCount: z.number().int(),
  wallets: z.array(walletAccount),
  requiredConsentsGranted: z.boolean(),
  stockTokenEligible: z.boolean(),
});
export type MeResponse = z.infer<typeof meResponse>;

export const patchMeRequest = z
  .object({
    displayName: z.string().trim().min(1).max(60).nullable().optional(),
    jurisdiction: z.string().regex(JURISDICTION_RE).optional(),
    experienceLevel: z.enum(EXPERIENCE_LEVELS).optional(),
    researchDepth: z.enum(RESEARCH_DEPTHS).optional(),
    interests: z.array(z.enum(INTERESTS)).max(INTERESTS.length).optional(),
    interestsSkipped: z.boolean().optional(),
    onboardingCompleted: z.literal(true).optional(),
  })
  .strict();
export type PatchMeRequest = z.infer<typeof patchMeRequest>;

// ---- Consents -----------------------------------------------------------------------------
export const consentStateItem = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  status: z.enum(["not_asked", "granted", "withdrawn", "outdated"]),
  policyVersion: z.string().nullable(),
  currentPolicyVersion: z.string(),
  updatedAt: z.string().nullable(),
  required: z.boolean(),
  available: z.boolean(),
  title: z.string(),
  summaryUrl: z.string(),
});
export const consentsResponse = z.object({ items: z.array(consentStateItem) });
export const postConsentRequest = consentEventSchema.strict();

// ---- Config -------------------------------------------------------------------------------
export const configResponse = z.object({
  flags: z.record(z.enum(FEATURE_FLAGS), z.boolean()),
  chains: z.array(
    z.object({ id: z.number(), name: z.string(), network: z.enum(["mainnet", "testnet"]) }),
  ),
});

export const stockTokenEligibilityResponse = z.object({
  eligible: z.boolean(),
  reason: z.enum(["restricted_jurisdiction", "jurisdiction_not_declared"]).optional(),
  network: z.literal("testnet"),
  chainId: z.literal(46630),
});

// ---- Extension ---------------------------------------------------------------
export const entityIdParam = z.string().regex(/^ent:[a-z0-9-]+$/);
export const pairingCodeResponse = z.object({
  code: z.string(),
  expiresAt: z.string(),
  extensionId: z.string().nullable(),
});
export const pairRequest = z
  .object({
    pairingCode: z.string().regex(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/),
    label: z.string().trim().min(1).max(60).optional(),
  })
  .strict();
export const pairResponse = z.object({
  installationId: z.uuid(),
  token: z.string(),
  handle: z.string(),
});
export const installationItem = z.object({
  id: z.uuid(),
  label: z.string().nullable(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
});
export const installationsResponse = z.object({ items: z.array(installationItem) });
export const extensionConfigResponse = z.object({
  notifyThreshold: z.number(),
  rateLimits: z.object({ perEntityMinutes: z.number().int(), perDomainPerHour: z.number().int() }),
  dictionaryVersion: z.string(),
  handle: z.string(),
  webOrigin: z.string(),
});
export const researchRequestItem = z.object({
  id: z.uuid(),
  entityId: z.string(),
  status: z.enum(["queued", "processing", "completed", "failed"]),
  source: z.enum(["extension", "web"]).optional(),
  sourceUrl: z.string().nullable(),
  hasExcerpt: z.boolean(),
  createdAt: z.string(),
  briefId: z.uuid().nullable().optional(),
  failureReason: z.string().nullable().optional(),
  /** Present when completed: shown in the extension side panel. */
  summary: z.string().nullable().optional(),
  topRisks: z.array(z.string()).optional(),
});
export const researchContextResponse = researchRequestItem.extend({ researchUrl: z.string() });
export const researchRequestsResponse = z.object({ items: z.array(researchRequestItem) });

export const entitySummary = z.object({
  canonicalId: z.string(),
  name: z.string(),
  legalName: z.string().nullable(),
  kind: z.enum(["company", "product", "fund", "index", "crypto"]),
  sector: z.string().nullable(),
  tickers: z.array(z.string()),
});
export const entitySearchQuery = z.object({ q: z.string().trim().min(1).max(60) });
export const entitySearchResponse = z.object({ items: z.array(entitySummary) });
export const instrumentItem = z.object({
  id: z.uuid(),
  symbol: z.string(),
  displayName: z.string(),
  network: z.enum(["mainnet", "testnet", "offchain"]),
  chainId: z.number().nullable(),
  legalType: z.enum(["simulated", "testnet_test_token", "demo_token", "unsupported"]),
  status: z.enum(["unverified", "active", "halted", "unsupported"]),
  label: z.string(),
  contractAddress: z.string().nullable(),
});
export const instrumentsResponse = z.object({ items: z.array(instrumentItem) });

export const watchlistAddRequest = z
  .object({ entityId: entityIdParam, note: z.string().trim().max(500).optional() })
  .strict();
export const watchlistItemResponse = z.object({
  id: z.uuid(),
  entityId: z.string(),
  name: z.string(),
  note: z.string().nullable(),
  addedAt: z.string(),
});
export const watchlistAddResponse = z.object({ item: watchlistItemResponse, created: z.boolean() });
export const watchlistResponse = z.object({
  id: z.uuid().nullable(),
  name: z.string(),
  items: z.array(watchlistItemResponse),
});

// ---- research, compare, watchlists, theses -------------------------------------
export const uuidParam = z.uuid();
export const createBriefRequest = z.object({ entityId: entityIdParam }).strict();
export const createBriefResponse = researchRequestItem;
export const briefListQuery = z.object({
  entityId: entityIdParam.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export const briefListItem = z.object({
  id: z.uuid(),
  entityId: z.string(),
  entityName: z.string(),
  summary: z.string(),
  model: z.string(),
  provider: z.string(),
  dataFreshness: z.enum(["fresh", "stale", "partial", "unknown"]),
  generatedAt: z.string(),
  cached: z.boolean(),
});
export const briefListResponse = z.object({ items: z.array(briefListItem) });
const answerClaim = z.object({
  id: z.string(),
  text: z.string(),
  kind: z.enum(["fact", "estimate", "analysis", "opinion"]),
  sourceIds: z.array(z.string()),
});
export const questionItem = z.object({
  id: z.uuid(),
  question: z.string(),
  insufficientSources: z.boolean(),
  claims: z.array(answerClaim),
  model: z.string(),
  provider: z.string(),
  createdAt: z.string(),
});
export const briefResponse = z.object({
  id: z.uuid(),
  entityId: z.string(),
  /** Full brief v1 (validated before it was stored). */
  brief: z.record(z.string(), z.unknown()),
  model: z.string(),
  provider: z.string(),
  promptVersion: z.string(),
  schemaVersion: z.string(),
  dataFreshness: z.enum(["fresh", "stale", "partial", "unknown"]),
  generatedAt: z.string(),
  cached: z.boolean(),
  questions: z.array(questionItem),
  myFeedback: z.array(
    z.object({
      kind: z.enum(["helpful", "incorrect", "outdated"]),
      note: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});
export const questionRequest = z.object({ question: z.string().trim().min(3).max(500) }).strict();
export const feedbackRequest = z
  .object({
    kind: z.enum(["helpful", "incorrect", "outdated"]),
    note: z.string().trim().max(1000).optional(),
  })
  .strict();
export const feedbackResponse = z.object({ id: z.uuid(), kind: z.string(), createdAt: z.string() });
export const compareRequest = z
  .object({ entityIds: z.array(entityIdParam).min(2).max(3) })
  .strict();
const compareCell = z.object({
  value: z.string().nullable(),
  unit: z.string().nullable(),
  currency: z.string().nullable(),
  period: z.string().nullable(),
  asOf: z.string().nullable(),
  basis: z.string().nullable(),
  formula: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  sourceLabel: z.string().nullable(),
});
export const compareResponse = z.object({
  entities: z.array(
    z.object({
      canonicalId: z.string(),
      name: z.string(),
      ticker: z.string().nullable(),
      dataNotes: z.array(z.string()),
    }),
  ),
  rows: z.array(z.object({ metric: z.string(), label: z.string(), cells: z.array(compareCell) })),
  generatedAt: z.string(),
});
export const quoteResponse = z.object({
  symbol: z.string(),
  currency: z.literal("USD"),
  price: z.string(),
  change: z.string().nullable(),
  changePercent: z.string().nullable(),
  previousClose: z.string().nullable(),
  asOf: z.string(),
  retrievedAt: z.string(),
  source: z.string(),
  sourceUrl: z.string(),
});

const direction = z.enum(["bullish", "bearish", "neutral"]);
export const thesisEvidenceRef = z
  .object({ briefId: z.uuid(), claimId: z.string().regex(/^c[0-9]{1,4}$/) })
  .strict();
export const thesisDraftRequest = z
  .object({ briefId: z.uuid(), direction: direction.optional() })
  .strict();
export const thesisDraftResponse = z.object({
  title: z.string(),
  direction,
  horizonDays: z.number().int(),
  rationale: z.string(),
  counterarguments: z.string(),
  risks: z.string(),
  invalidation: z.string(),
  evidence: z.array(z.object({ briefId: z.uuid(), claimId: z.string(), text: z.string() })),
  model: z.string(),
  provider: z.string(),
  promptVersion: z.string(),
  /** Always true: a draft for the user to edit. It is not saved. */
  aiDraft: z.literal(true),
  saved: z.literal(false),
});
export const thesisContent = z
  .object({
    direction,
    horizonDays: z.number().int().min(1).max(3650),
    title: z.string().trim().min(3).max(140),
    rationale: z.string().trim().min(1).max(4000),
    evidence: z.array(thesisEvidenceRef).max(10).default([]),
    counterarguments: z.string().trim().min(1).max(4000),
    risks: z.string().trim().min(1).max(4000),
    invalidation: z.string().trim().min(1).max(2000),
  })
  .strict();
export const createThesisRequest = thesisContent.extend({ entityId: entityIdParam }).strict();
export const updateThesisRequest = thesisContent;
export const visibilitySchema = z.enum(["private", "followers", "public"]);
export const publishThesisRequest = z.object({ visibility: visibilitySchema }).strict();
export const reviewThesisRequest = z
  .object({
    outcome: z.enum(["played_out", "did_not_play_out", "mixed", "too_early"]),
    note: z.string().trim().min(1).max(4000),
  })
  .strict();
export const priceContextSchema = z
  .object({
    symbol: z.string(),
    price: z.string(),
    currency: z.string(),
    asOf: z.string(),
    retrievedAt: z.string(),
    source: z.string(),
    sourceUrl: z.string(),
    /** SPY at the same moment: the start of the benchmark-relative evaluation. */
    benchmark: z
      .object({ symbol: z.string(), price: z.string(), asOf: z.string() })
      .nullable()
      .optional(),
  })
  .nullable();
export const thesisVersionItem = z.object({
  version: z.number().int(),
  direction,
  horizonDays: z.number().int(),
  title: z.string(),
  rationale: z.string(),
  evidence: z.array(z.object({ briefId: z.uuid(), claimId: z.string(), text: z.string() })),
  counterarguments: z.string(),
  risks: z.string(),
  invalidation: z.string(),
  priceContext: priceContextSchema,
  createdAt: z.string(),
});
export const thesisResponse = z.object({
  id: z.uuid(),
  entityId: z.string(),
  entityName: z.string(),
  owner: z.object({ handle: z.string().nullable(), isMe: z.boolean() }),
  visibility: visibilitySchema,
  status: z.enum(["draft", "published", "closed"]),
  currentVersion: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  publishedAt: z.string().nullable(),
  versions: z.array(thesisVersionItem),
  reviews: z.array(
    z.object({ id: z.uuid(), outcome: z.string(), note: z.string(), createdAt: z.string() }),
  ),
});
export const thesisListResponse = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      entityId: z.string(),
      entityName: z.string(),
      title: z.string(),
      direction,
      visibility: visibilitySchema,
      status: z.string(),
      currentVersion: z.number().int(),
      updatedAt: z.string(),
    }),
  ),
});

export const watchlistCreateRequest = z.object({ name: z.string().trim().min(1).max(60) }).strict();
export const watchlistItemAddRequest = z
  .object({ entityId: entityIdParam, note: z.string().trim().max(500).optional() })
  .strict();
export const watchlistItemPatchRequest = z
  .object({
    note: z.string().trim().max(500).nullable().optional(),
    thesisId: z.uuid().nullable().optional(),
  })
  .strict()
  .refine((v) => v.note !== undefined || v.thesisId !== undefined, "nothing to update");
export const watchlistFullItem = watchlistItemResponse.extend({
  thesisId: z.uuid().nullable(),
  ticker: z.string().nullable(),
});
export const watchlistFull = z.object({
  id: z.uuid(),
  name: z.string(),
  createdAt: z.string(),
  items: z.array(watchlistFullItem),
});
export const watchlistsResponse = z.object({ items: z.array(watchlistFull) });
export const watchlistItemMutationResponse = z.object({
  item: watchlistFullItem,
  created: z.boolean(),
});

// ---- orders and portfolio ----------------------------------------------------
const decimalString = z
  .string()
  .regex(/^(0|[1-9][0-9]{0,15})(\.[0-9]{1,18})?$/, "a plain decimal amount");
/** `book` never accepts "live" (trading.live is hard-off, ADR-0004). */
export const orderBook = z.enum(["simulated", "testnet"]);
export const orderPreviewRequest = z
  .object({
    entityId: entityIdParam,
    book: orderBook,
    side: z.enum(["buy", "sell"]),
    amount: decimalString,
  })
  .strict();
const check = z.object({ name: z.string(), ok: z.boolean(), detail: z.string() });
export const orderPreviewResponse = z.object({
  orderId: z.uuid(),
  book: orderBook,
  bookLabel: z.string(),
  side: z.enum(["buy", "sell"]),
  instrument: z.object({
    symbol: z.string(),
    displayName: z.string(),
    legalTypeLabel: z.string(),
    network: z.enum(["testnet", "offchain"]),
    chainId: z.number().nullable(),
    address: z.string().nullable(),
  }),
  amountIn: z.object({ value: z.string(), asset: z.string() }),
  estimatedOut: z.object({ value: z.string(), asset: z.string() }),
  minOut: z.object({ value: z.string(), asset: z.string() }),
  fee: z.object({ value: z.string(), asset: z.string(), bps: z.number() }),
  slippageBps: z.number(),
  price: z.object({
    value: z.string(),
    executionPrice: z.string(),
    currency: z.string(),
    at: z.string(),
    source: z.string(),
    sourceUrl: z.string(),
  }),
  expiresAt: z.string(),
  route: z.object({
    venue: z.string().nullable(),
    explorerUrl: z.string().nullable(),
    description: z.string(),
  }),
  /** The linked wallet that must sign (testnet). */
  trader: z.string().nullable(),
  approval: z
    .object({
      needed: z.boolean(),
      token: z.string(),
      spender: z.string(),
      amount: z.string(),
      data: z.string(),
    })
    .nullable(),
  tx: z
    .object({ chainId: z.number(), to: z.string(), data: z.string(), value: z.literal("0") })
    .nullable(),
  previewHash: z.string(),
  simulation: z.object({ ran: z.boolean(), ok: z.boolean(), detail: z.string() }),
  checks: z.array(check),
  risks: z.array(z.string()),
});
export const orderConfirmRequest = z
  .object({
    orderId: z.uuid(),
    previewHash: z.string().regex(/^0x[0-9a-f]{64}$/),
    acknowledged: z.literal(true),
  })
  .strict();
export const orderTxRequest = z
  .object({ txHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) })
  .strict();
export const orderStatus = z.enum([
  "previewed",
  "pending",
  "submitted",
  "filled",
  "failed",
  "expired",
  "cancelled",
  "partially_filled",
]);
export const orderResponse = z.object({
  id: z.uuid(),
  book: orderBook,
  bookLabel: z.string(),
  side: z.enum(["buy", "sell"]),
  status: orderStatus,
  symbol: z.string(),
  displayName: z.string(),
  entityId: z.string().nullable(),
  amountIn: z.object({ value: z.string(), asset: z.string() }),
  estimatedOut: z.object({ value: z.string(), asset: z.string() }),
  filledOut: z.object({ value: z.string(), asset: z.string() }).nullable(),
  fee: z.string(),
  price: z.string(),
  quoteAt: z.string(),
  expiresAt: z.string(),
  txHash: z.string().nullable(),
  explorerUrl: z.string().nullable(),
  failureReason: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export const orderEventsResponse = z.object({
  items: z.array(
    z.object({
      status: z.string(),
      details: z.record(z.string(), z.unknown()),
      createdAt: z.string(),
    }),
  ),
});
const money = z.object({ value: z.string(), currency: z.string() });
export const portfolioPosition = z.object({
  instrumentSymbol: z.string(),
  displayName: z.string(),
  entityId: z.string().nullable(),
  quantity: z.string(),
  averageCost: money.nullable(),
  costBasis: money,
  price: z.object({ value: z.string(), at: z.string(), source: z.string() }).nullable(),
  marketValue: money.nullable(),
  unrealizedPnl: money.nullable(),
  realizedPnl: money,
});
export const portfolioBook = z.object({
  book: z.enum(["simulated", "testnet", "faucet"]),
  label: z.string(),
  currency: z.string(),
  positions: z.array(portfolioPosition),
  totals: z
    .object({
      costBasis: money,
      marketValue: money.nullable(),
      unrealizedPnl: money.nullable(),
      realizedPnl: money,
    })
    .nullable(),
  note: z.string().nullable(),
});
/** Three books, never summed together (PRD §8.4): there is deliberately no combined total. */
export const portfolioResponse = z
  .object({
    books: z.object({ simulated: portfolioBook, testnet: portfolioBook, faucet: portfolioBook }),
    methodology: z.string(),
  })
  .strict();
export const portfolioTransactionsResponse = z.object({ items: z.array(orderResponse) });
export const portfolioHistoryResponse = z.object({
  books: z.object({
    simulated: z.array(z.object({ at: z.string(), value: z.string() })),
    testnet: z.array(z.object({ at: z.string(), value: z.string() })),
  }),
  note: z.string(),
});
export const faucetHoldingsResponse = z.object({
  label: z.string(),
  items: z.array(
    z.object({
      wallet: z.string(),
      symbol: z.string(),
      name: z.string(),
      address: z.string(),
      balance: z.string(),
      status: z.enum(["active", "unverified"]),
    }),
  ),
  note: z.string().nullable(),
});

export const investStatusResponse = z.object({
  eligibility: z.object({
    eligible: z.boolean(),
    reason: z.string().nullable(),
    message: z.string().nullable(),
  }),
  testnet: z.object({
    available: z.boolean(),
    reason: z.string().nullable(),
    chainId: z.literal(46630),
    venue: z.string().nullable(),
    dusd: z.string().nullable(),
    tokens: z.record(z.string(), z.string()),
    explorer: z.string(),
    faucetUrl: z.string(),
    wallets: z.array(z.string()),
  }),
  simulated: z.object({ available: z.literal(true), feeBps: z.number(), slippageBps: z.number() }),
  quoteTtlSeconds: z.number(),
});
