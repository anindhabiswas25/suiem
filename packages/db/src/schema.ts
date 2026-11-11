/**
 * Drizzle definitions mirroring migrations/*.sql (the SQL is the source of truth).
 * `db.int.test.ts` checks every table and column here exists in the migrated database.
 * Amount columns are numeric strings (base units). Never convert them to JS numbers.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  customType,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => "bytea" });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
/** numeric(78,0) base units, as a string. */
const units = (name: string) => numeric(name, { precision: 78, scale: 0 });
const dec = (name: string) => smallint(name);
type Visibility = "private" | "followers" | "public";
type Book = "simulated" | "testnet";
type Finality = "soft" | "safe" | "final";

// ---- Identity ---------------------------------------------------------------------------
export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  handle: text("handle").notNull(),
  displayName: text("display_name"),
  status: text("status")
    .$type<"active" | "restricted" | "deletion_requested" | "deleted">()
    .notNull()
    .default("active"),
  isDemo: boolean("is_demo").notNull().default(false),
  /** Set only by the CLI script `pnpm user:role` (column not updatable by the API role). */
  role: text("role").$type<"user" | "moderator">().notNull().default("user"),
  handleChangedAt: ts("handle_changed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const walletAccounts = pgTable("wallet_accounts", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  address: bytea("address").notNull(),
  chainId: integer("chain_id").notNull(),
  siweMessageHash: bytea("siwe_message_hash").notNull(),
  linkedAt: ts("linked_at").notNull().defaultNow(),
  unlinkedAt: ts("unlinked_at"),
});

export const authMethods = pgTable("auth_methods", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  kind: text("kind").$type<"passkey" | "siwe">().notNull(),
  credentialId: bytea("credential_id"),
  publicKey: bytea("public_key"),
  signCount: bigint("sign_count", { mode: "bigint" })
    .notNull()
    .default(sql`0`),
  transports: text("transports")
    .array()
    .notNull()
    .default(sql`'{}'`),
  deviceType: text("device_type"),
  backedUp: boolean("backed_up"),
  walletAccountId: uuid("wallet_account_id"),
  label: text("label"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  tokenHash: bytea("token_hash").notNull(),
  amr: text("amr").array().notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  rotatedFrom: uuid("rotated_from"),
});

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id").primaryKey(),
  interests: text("interests")
    .array()
    .notNull()
    .default(sql`'{}'`),
  interestsSkipped: boolean("interests_skipped").notNull().default(false),
  experienceLevel: text("experience_level"),
  researchDepth: text("research_depth"),
  jurisdiction: char("jurisdiction", { length: 2 }),
  onboardingCompletedAt: ts("onboarding_completed_at"),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ---- Consent ----------------------------------------------------------------------------
export const policyVersions = pgTable("policy_versions", {
  id: uuid("id").primaryKey(),
  purpose: text("purpose").notNull(),
  version: text("version").notNull(),
  title: text("title").notNull(),
  summaryUrl: text("summary_url").notNull(),
  contentSha256: bytea("content_sha256").notNull(),
  publishedAt: ts("published_at").notNull(),
});

export const consentRecords = pgTable("consent_records", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  purpose: text("purpose").notNull(),
  policyVersion: text("policy_version").notNull(),
  action: text("action").$type<"granted" | "withdrawn">().notNull(),
  source: text("source").notNull().default("web"),
  recordedAt: ts("recorded_at").notNull().defaultNow(),
});

// ---- Registry ---------------------------------------------------------------------------
export const entities = pgTable("entities", {
  id: uuid("id").primaryKey(),
  canonicalId: text("canonical_id").notNull(),
  name: text("name").notNull(),
  legalName: text("legal_name"),
  kind: text("kind").$type<"company" | "product" | "fund" | "index" | "crypto">().notNull(),
  sector: text("sector"),
  country: char("country", { length: 2 }),
  description: text("description"),
  cik: char("cik", { length: 10 }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const entityAliases = pgTable("entity_aliases", {
  id: uuid("id").primaryKey(),
  entityId: uuid("entity_id").notNull(),
  alias: text("alias").notNull(),
  aliasType: text("alias_type")
    .$type<"name" | "legal_name" | "ticker" | "cashtag" | "exchange_symbol" | "product">()
    .notNull(),
  ambiguous: boolean("ambiguous").notNull().default(false),
});

export const instruments = pgTable("instruments", {
  id: uuid("id").primaryKey(),
  entityId: uuid("entity_id"),
  symbol: text("symbol").notNull(),
  displayName: text("display_name").notNull(),
  network: text("network").$type<"mainnet" | "testnet" | "offchain">().notNull(),
  chainId: integer("chain_id"),
  legalType: text("legal_type")
    .$type<"simulated" | "testnet_test_token" | "demo_token" | "unsupported">()
    .notNull(),
  contractAddress: bytea("contract_address"),
  decimals: dec("decimals").notNull(),
  quoteCurrency: char("quote_currency", { length: 3 }).notNull().default("USD"),
  status: text("status")
    .$type<"unverified" | "active" | "halted" | "unsupported">()
    .notNull()
    .default("unverified"),
  sourceUrl: text("source_url"),
  lastVerifiedAt: ts("last_verified_at"),
  notes: text("notes"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---- Research ---------------------------------------------------------------------------
export const researchBriefs = pgTable("research_briefs", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  entityId: uuid("entity_id"),
  schemaVersion: text("schema_version").notNull(),
  brief: jsonb("brief").notNull(),
  model: text("model").notNull(),
  promptVersion: text("prompt_version").notNull(),
  dataFreshness: text("data_freshness")
    .$type<"fresh" | "stale" | "partial" | "unknown">()
    .notNull(),
  visibility: text("visibility").$type<Visibility>().notNull().default("private"),
  createdAt: ts("created_at").notNull().defaultNow(),
  sourcePack: jsonb("source_pack")
    .notNull()
    .default(sql`'[]'::jsonb`),
  publicOnly: boolean("public_only").notNull().default(true),
  cachedFrom: uuid("cached_from"),
  generatedAt: ts("generated_at").notNull().defaultNow(),
  provider: text("provider").notNull().default("unknown"),
});

export const briefSources = pgTable("brief_sources", {
  id: uuid("id").primaryKey(),
  briefId: uuid("brief_id").notNull(),
  url: text("url").notNull(),
  title: text("title").notNull(),
  publisher: text("publisher"),
  publishedAt: ts("published_at"),
  retrievedAt: ts("retrieved_at").notNull(),
  supports: text("supports")
    .array()
    .notNull()
    .default(sql`'{}'`),
});

export const watchlists = pgTable("watchlists", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  name: text("name").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const watchlistItems = pgTable("watchlist_items", {
  id: uuid("id").primaryKey(),
  watchlistId: uuid("watchlist_id").notNull(),
  entityId: uuid("entity_id").notNull(),
  instrumentId: uuid("instrument_id"),
  note: text("note"),
  addedAt: ts("added_at").notNull().defaultNow(),
  thesisId: uuid("thesis_id"),
});

export const theses = pgTable("theses", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  entityId: uuid("entity_id").notNull(),
  instrumentId: uuid("instrument_id"),
  currentVersion: integer("current_version").notNull().default(1),
  visibility: text("visibility").$type<Visibility>().notNull().default("private"),
  status: text("status").$type<"draft" | "published" | "closed">().notNull().default("draft"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  publishedAt: ts("published_at"),
  aiAssisted: boolean("ai_assisted").notNull().default(false),
});

export const thesisVersions = pgTable("thesis_versions", {
  id: uuid("id").primaryKey(),
  thesisId: uuid("thesis_id").notNull(),
  version: integer("version").notNull(),
  direction: text("direction").$type<"bullish" | "bearish" | "neutral">().notNull(),
  horizonDays: integer("horizon_days").notNull(),
  title: text("title").notNull(),
  rationale: text("rationale").notNull(),
  evidence: jsonb("evidence")
    .notNull()
    .default(sql`'[]'::jsonb`),
  counterarguments: text("counterarguments").notNull(),
  risks: text("risks").notNull(),
  invalidation: text("invalidation").notNull(),
  priceContext: jsonb("price_context"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---- Invest -----------------------------------------------------------------------------
export const orders = pgTable("orders", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  instrumentId: uuid("instrument_id").notNull(),
  book: text("book").$type<Book>().notNull(),
  side: text("side").$type<"buy" | "sell">().notNull(),
  status: text("status")
    .$type<
      | "previewed"
      | "submitted"
      | "pending"
      | "partially_filled"
      | "filled"
      | "failed"
      | "expired"
      | "cancelled"
    >()
    .notNull(),
  quoteAmount: units("quote_amount").notNull(),
  quoteDecimals: dec("quote_decimals").notNull(),
  quoteAsset: text("quote_asset").notNull(),
  estQuantity: units("est_quantity").notNull(),
  quantityDecimals: dec("quantity_decimals").notNull(),
  feeAmount: units("fee_amount").notNull().default("0"),
  maxSlippageBps: integer("max_slippage_bps").notNull(),
  quoteAt: ts("quote_at").notNull(),
  quoteExpiresAt: ts("quote_expires_at").notNull(),
  chainId: integer("chain_id"),
  txHash: bytea("tx_hash"),
  previewHash: bytea("preview_hash").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  // 0005_invest
  trader: bytea("trader"),
  venue: bytea("venue"),
  quoteNonce: numeric("quote_nonce", { precision: 78, scale: 0 }),
  quotePrice: units("quote_price"),
  priceDecimals: dec("price_decimals"),
  minOut: units("min_out"),
  feeBps: integer("fee_bps"),
  calldata: bytea("calldata"),
  quoteSource: jsonb("quote_source"),
  failureReason: text("failure_reason"),
  confirmedAt: ts("confirmed_at"),
  filledQuantity: units("filled_quantity"),
  filledAmount: units("filled_amount"),
});

export const orderEvents = pgTable("order_events", {
  id: uuid("id").primaryKey(),
  orderId: uuid("order_id").notNull(),
  status: text("status").notNull(),
  details: jsonb("details")
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const fills = pgTable("fills", {
  id: uuid("id").primaryKey(),
  orderId: uuid("order_id").notNull(),
  quantity: units("quantity").notNull(),
  quantityDecimals: dec("quantity_decimals").notNull(),
  price: units("price").notNull(),
  priceDecimals: dec("price_decimals").notNull(),
  feeAmount: units("fee_amount").notNull().default("0"),
  chainId: integer("chain_id"),
  txHash: bytea("tx_hash"),
  logIndex: integer("log_index"),
  filledAt: ts("filled_at").notNull(),
});

export const positions = pgTable("positions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  instrumentId: uuid("instrument_id").notNull(),
  book: text("book").$type<Book>().notNull(),
  quantity: units("quantity").notNull(),
  quantityDecimals: dec("quantity_decimals").notNull(),
  costBasis: units("cost_basis").notNull(),
  costDecimals: dec("cost_decimals").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const ledgerEntries = pgTable("ledger_entries", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  book: text("book").$type<Book>().notNull(),
  instrumentId: uuid("instrument_id"),
  asset: text("asset").notNull(),
  amount: units("amount").notNull(),
  decimals: dec("decimals").notNull(),
  entryType: text("entry_type")
    .$type<"deposit" | "buy" | "sell" | "fee" | "adjustment">()
    .notNull(),
  orderId: uuid("order_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---- Social -----------------------------------------------------------------------------
export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey(),
  bio: text("bio"),
  portfolioVisibility: text("portfolio_visibility")
    .$type<Visibility>()
    .notNull()
    .default("private"),
  positionsVisibility: text("positions_visibility")
    .$type<Visibility>()
    .notNull()
    .default("private"),
  transactionsVisibility: text("transactions_visibility")
    .$type<Visibility>()
    .notNull()
    .default("private"),
  researchActivityVisibility: text("research_activity_visibility")
    .$type<Visibility>()
    .notNull()
    .default("private"),
  followersVisibility: text("followers_visibility")
    .$type<Visibility>()
    .notNull()
    .default("private"),
  thesesVisibility: text("theses_visibility").$type<Visibility>().notNull().default("private"),
  walletVisibility: text("wallet_visibility").$type<Visibility>().notNull().default("private"),
  appearInLeaderboards: boolean("appear_in_leaderboards").notNull().default(false),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const follows = pgTable(
  "follows",
  {
    followerId: uuid("follower_id").notNull(),
    followeeId: uuid("followee_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.followerId, t.followeeId] })],
);

export const posts = pgTable("posts", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  kind: text("kind").notNull(),
  body: text("body").notNull(),
  entityId: uuid("entity_id"),
  thesisId: uuid("thesis_id"),
  briefId: uuid("brief_id"),
  visibility: text("visibility").$type<Visibility>().notNull(),
  aiAssisted: boolean("ai_assisted").notNull().default(false),
  sponsored: boolean("sponsored").notNull().default(false),
  sourced: boolean("sourced").notNull().default(false),
  attachment: jsonb("attachment"),
  createdAt: ts("created_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
  hiddenAt: ts("hidden_at"),
  hiddenReason: text("hidden_reason"),
});

export const comments = pgTable("comments", {
  id: uuid("id").primaryKey(),
  postId: uuid("post_id").notNull(),
  userId: uuid("user_id").notNull(),
  parentId: uuid("parent_id"),
  body: text("body").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  deletedAt: ts("deleted_at"),
  hiddenAt: ts("hidden_at"),
  hiddenReason: text("hidden_reason"),
});

export const reactions = pgTable(
  "reactions",
  {
    postId: uuid("post_id").notNull(),
    userId: uuid("user_id").notNull(),
    kind: text("kind").$type<"like" | "helpful" | "not_helpful">().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.postId, t.userId, t.kind] })],
);

export const bookmarks = pgTable(
  "bookmarks",
  {
    userId: uuid("user_id").notNull(),
    postId: uuid("post_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.postId] })],
);

// ---- Reputation -------------------------------------------------------------------------
export const reputationEvidence = pgTable("reputation_evidence", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  component: text("component").notNull(),
  sourceType: text("source_type").notNull(),
  sourceId: uuid("source_id").notNull(),
  book: text("book").$type<Book>(),
  value: numeric("value", { precision: 20, scale: 6 }).notNull(),
  methodologyVersion: text("methodology_version").notNull(),
  observedAt: ts("observed_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const reputationSnapshots = pgTable("reputation_snapshots", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  methodologyVersion: text("methodology_version").notNull(),
  maturity: text("maturity").$type<"building" | "ranked">().notNull(),
  suiemScore: numeric("suiem_score", { precision: 5, scale: 2 }),
  investorScore: numeric("investor_score", { precision: 5, scale: 2 }),
  contributionScore: numeric("contribution_score", { precision: 5, scale: 2 }),
  components: jsonb("components").notNull(),
  computedAt: ts("computed_at").notNull().defaultNow(),
  snapshotHash: bytea("snapshot_hash"),
  previousId: uuid("previous_id"),
});

// ---- $WIF economy (mainnet) ---------------------------------------------------------------
export const elections = pgTable("elections", {
  id: uuid("id").primaryKey(),
  slug: text("slug").notNull(),
  title: text("title").notNull(),
  category: text("category")
    .$type<"research_contributor" | "investor" | "educational" | "community_spotlight">()
    .notNull(),
  chainId: integer("chain_id").notNull(),
  contractAddress: bytea("contract_address"),
  onchainElectionId: units("onchain_election_id"),
  startsAt: ts("starts_at").notNull(),
  endsAt: ts("ends_at").notNull(),
  status: text("status")
    .$type<"draft" | "scheduled" | "open" | "closed" | "finalized" | "cancelled">()
    .notNull()
    .default("draft"),
  rules: jsonb("rules")
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdBy: uuid("created_by"),
  createdAt: ts("created_at").notNull().defaultNow(),
  finalizedAt: ts("finalized_at"),
});

export const electionCandidates = pgTable("election_candidates", {
  id: uuid("id").primaryKey(),
  electionId: uuid("election_id").notNull(),
  userId: uuid("user_id").notNull(),
  onchainCandidateId: units("onchain_candidate_id"),
  nominationPostId: uuid("nomination_post_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const chainEvents = pgTable("chain_events", {
  id: uuid("id").primaryKey(),
  chainId: integer("chain_id").notNull(),
  contractAddress: bytea("contract_address").notNull(),
  txHash: bytea("tx_hash").notNull(),
  logIndex: integer("log_index").notNull(),
  blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
  blockHash: bytea("block_hash").notNull(),
  eventName: text("event_name").notNull(),
  args: jsonb("args").notNull(),
  finality: text("finality").$type<Finality>().notNull(),
  removed: boolean("removed").notNull().default(false),
  observedAt: ts("observed_at").notNull().defaultNow(),
});

export const electionTallies = pgTable(
  "election_tallies",
  {
    electionId: uuid("election_id").notNull(),
    candidateId: uuid("candidate_id").notNull(),
    votes: units("votes").notNull().default("0"),
    decimals: dec("decimals").notNull().default(18),
    asOfBlock: bigint("as_of_block", { mode: "bigint" }).notNull(),
    finality: text("finality").$type<Finality>().notNull(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.electionId, t.candidateId] })],
);

// ---- Operations -------------------------------------------------------------------------
export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey(),
  occurredAt: ts("occurred_at").notNull().defaultNow(),
  actorType: text("actor_type").$type<"user" | "admin" | "system" | "anonymous">().notNull(),
  actorUserId: uuid("actor_user_id"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  outcome: text("outcome").$type<"success" | "denied" | "error">().notNull(),
  requestId: text("request_id"),
  details: jsonb("details")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
});

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    scope: text("scope").notNull(),
    route: text("route").notNull(),
    key: text("key").notNull(),
    requestHash: bytea("request_hash").notNull(),
    responseStatus: integer("response_status"),
    responseBody: jsonb("response_body"),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.scope, t.route, t.key] })],
);

export const featureFlags = pgTable("feature_flags", {
  key: text("key")
    .$type<"trading.live" | "trading.testnet" | "elections" | "campaigns">()
    .primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ---- Extension (0003) -------------------------------------------------------------------
export const extensionInstallations = pgTable("extension_installations", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  tokenHash: bytea("token_hash").notNull(),
  label: text("label"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at"),
  revokedAt: ts("revoked_at"),
});

export const extensionPairingCodes = pgTable("extension_pairing_codes", {
  codeHash: bytea("code_hash").primaryKey(),
  userId: uuid("user_id").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

export const researchRequests = pgTable("research_requests", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  entityId: uuid("entity_id").notNull(),
  installationId: uuid("installation_id"),
  sourceUrl: text("source_url"),
  excerpt: text("excerpt"),
  failureReason: text("failure_reason"),
  source: text("source").$type<"extension" | "web">().notNull().default("extension"),
  status: text("status")
    .$type<"queued" | "processing" | "completed" | "failed">()
    .notNull()
    .default("queued"),
  briefId: uuid("brief_id"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

// ---- Research (0004) --------------------------------------------------------------------
export const researchSourceCache = pgTable(
  "research_source_cache",
  {
    provider: text("provider").$type<"edgar" | "finnhub">().notNull(),
    key: text("key").notNull(),
    payload: jsonb("payload").notNull(),
    retrievedAt: ts("retrieved_at").notNull(),
    expiresAt: ts("expires_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.provider, t.key] })],
);

export const briefFeedback = pgTable("brief_feedback", {
  id: uuid("id").primaryKey(),
  briefId: uuid("brief_id").notNull(),
  userId: uuid("user_id").notNull(),
  kind: text("kind").$type<"helpful" | "incorrect" | "outdated">().notNull(),
  note: text("note"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const researchQuestions = pgTable("research_questions", {
  id: uuid("id").primaryKey(),
  briefId: uuid("brief_id").notNull(),
  userId: uuid("user_id").notNull(),
  question: text("question").notNull(),
  answer: jsonb("answer").notNull(),
  model: text("model").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const thesisReviews = pgTable("thesis_reviews", {
  id: uuid("id").primaryKey(),
  thesisId: uuid("thesis_id").notNull(),
  userId: uuid("user_id").notNull(),
  outcome: text("outcome")
    .$type<"played_out" | "did_not_play_out" | "mixed" | "too_early">()
    .notNull(),
  note: text("note").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
});

// ---- Sprint 6: social graph, moderation, thesis evaluation, appeals, notifications ---------
export const mutes = pgTable(
  "mutes",
  {
    muterId: uuid("muter_id").notNull(),
    mutedId: uuid("muted_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.muterId, t.mutedId] })],
);

export const blocks = pgTable(
  "blocks",
  {
    blockerId: uuid("blocker_id").notNull(),
    blockedId: uuid("blocked_id").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.blockerId, t.blockedId] })],
);

export const commentReactions = pgTable(
  "comment_reactions",
  {
    commentId: uuid("comment_id").notNull(),
    userId: uuid("user_id").notNull(),
    kind: text("kind").$type<"helpful" | "not_helpful">().notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.commentId, t.userId] })],
);

export type ReportReason =
  | "spam"
  | "scam"
  | "harassment"
  | "impersonation"
  | "manipulation"
  | "undisclosed_sponsorship"
  | "fraudulent_performance"
  | "other";

export const moderationReports = pgTable("moderation_reports", {
  id: uuid("id").primaryKey(),
  reporterId: uuid("reporter_id").notNull(),
  targetType: text("target_type").$type<"post" | "comment" | "user">().notNull(),
  targetId: uuid("target_id").notNull(),
  reason: text("reason").$type<ReportReason>().notNull(),
  note: text("note"),
  status: text("status").$type<"open" | "actioned" | "dismissed">().notNull().default("open"),
  resolvedBy: uuid("resolved_by"),
  resolvedAt: ts("resolved_at"),
  resolutionReason: text("resolution_reason"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const benchmarkMarks = pgTable("benchmark_marks", {
  id: uuid("id").primaryKey(),
  symbol: text("symbol").notNull(),
  price: numeric("price", { precision: 20, scale: 6 }).notNull(),
  asOf: ts("as_of").notNull(),
  source: text("source").notNull(),
  observedAt: ts("observed_at").notNull().defaultNow(),
});

export const thesisEvaluations = pgTable("thesis_evaluations", {
  id: uuid("id").primaryKey(),
  thesisId: uuid("thesis_id").notNull(),
  thesisVersion: integer("thesis_version").notNull(),
  userId: uuid("user_id").notNull(),
  methodology: text("methodology").notNull(),
  status: text("status").$type<"evaluated" | "unevaluable">().notNull(),
  direction: text("direction").$type<"bullish" | "bearish" | "neutral">().notNull(),
  horizonDays: integer("horizon_days").notNull(),
  windowStart: ts("window_start").notNull(),
  windowEnd: ts("window_end").notNull(),
  symbol: text("symbol"),
  startPrice: numeric("start_price", { precision: 20, scale: 6 }),
  endPrice: numeric("end_price", { precision: 20, scale: 6 }),
  benchmarkSymbol: text("benchmark_symbol").notNull(),
  benchmarkStart: numeric("benchmark_start", { precision: 20, scale: 6 }),
  benchmarkEnd: numeric("benchmark_end", { precision: 20, scale: 6 }),
  instrumentReturnPpm: bigint("instrument_return_ppm", { mode: "bigint" }),
  benchmarkReturnPpm: bigint("benchmark_return_ppm", { mode: "bigint" }),
  relativeReturnPpm: bigint("relative_return_ppm", { mode: "bigint" }),
  correct: boolean("correct"),
  reason: text("reason"),
  sources: jsonb("sources").notNull(),
  evaluatedAt: ts("evaluated_at").notNull().defaultNow(),
});

export const reputationAppeals = pgTable("reputation_appeals", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  snapshotId: uuid("snapshot_id"),
  reason: text("reason").notNull(),
  status: text("status").$type<"open" | "reviewed" | "recalculated">().notNull().default("open"),
  resolvedBy: uuid("resolved_by"),
  resolvedAt: ts("resolved_at"),
  resolutionNote: text("resolution_note"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export type NotificationKind =
  | "new_follower"
  | "comment"
  | "reply"
  | "helpful"
  | "thesis_evaluated"
  | "report_outcome"
  | "appeal_outcome";

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  kind: text("kind").$type<NotificationKind>().notNull(),
  actorId: uuid("actor_id"),
  postId: uuid("post_id"),
  commentId: uuid("comment_id"),
  thesisId: uuid("thesis_id"),
  details: jsonb("details").notNull().default({}),
  readAt: ts("read_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/** Tables protected by append-only triggers (must match the migration). */
export const APPEND_ONLY_TABLES = [
  "consent_records",
  "thesis_versions",
  "order_events",
  "ledger_entries",
  "reputation_evidence",
  "audit_logs",
  "policy_versions",
  "thesis_reviews",
  "thesis_evaluations",
  "reputation_snapshots",
  "benchmark_marks",
] as const;
