/**
 * Drizzle table definitions mirroring migrations/*.sql (the SQL is the source of truth).
 * `schema.int.test.ts` checks that every table and column here exists in the migrated database.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  customType,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  email: text("email").notNull(),
  status: text("status").notNull().default("active"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const userAuthMethods = pgTable("user_auth_methods", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  kind: text("kind").$type<"email_otp" | "passkey">().notNull(),
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
  label: text("label"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastUsedAt: ts("last_used_at"),
  revokedAt: ts("revoked_at"),
});

export const userSessions = pgTable("user_sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  tokenHash: bytea("token_hash").notNull(),
  amr: text("amr").array().notNull(),
  passkeyVerifiedAt: ts("passkey_verified_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at").notNull().defaultNow(),
  expiresAt: ts("expires_at").notNull(),
  revokedAt: ts("revoked_at"),
  rotatedFrom: uuid("rotated_from"),
});

export const devices = pgTable("devices", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  kind: text("kind").notNull(),
  label: text("label"),
  createdAt: ts("created_at").notNull().defaultNow(),
  lastSeenAt: ts("last_seen_at"),
  revokedAt: ts("revoked_at"),
});

export const walletAccounts = pgTable("wallet_accounts", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  chainId: integer("chain_id").notNull(),
  address: bytea("address").notNull(),
  kind: text("kind").$type<"external_eoa" | "smart_account">().notNull(),
  siweMessageHash: bytea("siwe_message_hash").notNull(),
  linkedAt: ts("linked_at").notNull().defaultNow(),
  unlinkedAt: ts("unlinked_at"),
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
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey(),
  displayName: text("display_name"),
  jurisdiction: char("jurisdiction", { length: 2 }),
  onboardingCompletedAt: ts("onboarding_completed_at"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

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

export const dataRequests = pgTable("data_requests", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  type: text("type").$type<"export" | "delete">().notNull(),
  status: text("status")
    .$type<"received" | "processing" | "completed" | "rejected">()
    .notNull()
    .default("received"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  completedAt: ts("completed_at"),
});

export const auditLogs = pgTable("audit_logs", {
  id: uuid("id").primaryKey(),
  occurredAt: ts("occurred_at").notNull().defaultNow(),
  actorType: text("actor_type").$type<"user" | "admin" | "system" | "anonymous">().notNull(),
  actorUserId: uuid("actor_user_id"),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  outcome: text("outcome").$type<"success" | "denied" | "error">().notNull(),
  reasonCode: text("reason_code"),
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

export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").primaryKey(),
  topic: text("topic").notNull(),
  payload: jsonb("payload").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  publishedAt: ts("published_at"),
  attempts: integer("attempts").notNull().default(0),
});

export const featureFlags = pgTable("feature_flags", {
  key: text("key").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  updatedBy: uuid("updated_by"),
});

export const jurisdictionPolicies = pgTable("jurisdiction_policies", {
  version: text("version").primaryKey(),
  rules: jsonb("rules").$type<JurisdictionRules>().notNull(),
  publishedAt: ts("published_at").notNull().defaultNow(),
  createdBy: uuid("created_by"),
});

export const policyDecisions = pgTable("policy_decisions", {
  id: uuid("id").primaryKey(),
  decidedAt: ts("decided_at").notNull().defaultNow(),
  policyVersion: text("policy_version").notNull(),
  capability: text("capability").notNull(),
  subjectUserId: uuid("subject_user_id"),
  jurisdiction: char("jurisdiction", { length: 2 }),
  allowed: boolean("allowed").notNull(),
  reason: text("reason").notNull(),
  requestId: text("request_id"),
});

export const adminRoles = pgTable("admin_roles", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  role: text("role").notNull(),
  grantedAt: ts("granted_at").notNull().defaultNow(),
  grantedBy: uuid("granted_by"),
  revokedAt: ts("revoked_at"),
  revokedBy: uuid("revoked_by"),
});

export const dualControlRequests = pgTable("dual_control_requests", {
  id: uuid("id").primaryKey(),
  action: text("action").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  requestedBy: uuid("requested_by").notNull(),
  requestedAt: ts("requested_at").notNull().defaultNow(),
  reasonCode: text("reason_code").notNull(),
  reasonNote: text("reason_note").notNull(),
  status: text("status")
    .$type<"pending" | "approved" | "rejected" | "expired" | "executed" | "failed">()
    .notNull()
    .default("pending"),
  decidedBy: uuid("decided_by"),
  decidedAt: ts("decided_at"),
  decisionReasonCode: text("decision_reason_code"),
  decisionNote: text("decision_note"),
  expiresAt: ts("expires_at").notNull(),
});

export const adminActions = pgTable("admin_actions", {
  id: uuid("id").primaryKey(),
  occurredAt: ts("occurred_at").notNull().defaultNow(),
  adminUserId: uuid("admin_user_id").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: text("target_id"),
  reasonCode: text("reason_code").notNull(),
  reasonNote: text("reason_note").notNull(),
  dualControlRequestId: uuid("dual_control_request_id"),
  outcome: text("outcome").$type<"success" | "denied" | "error">().notNull(),
  details: jsonb("details")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
});

/** Jurisdiction policy document shape (validated in apps/api/src/flags/policy.ts). */
export interface JurisdictionRules {
  default: Record<string, boolean>;
  undeclared: Record<string, boolean>;
  jurisdictions: Record<string, Record<string, boolean>>;
}

/** Tables with RLS keyed by app.user_id (must match the migration). */
export const RLS_TABLES = [
  "users",
  "user_auth_methods",
  "user_sessions",
  "devices",
  "wallet_accounts",
  "user_preferences",
  "profiles",
  "consent_records",
  "data_requests",
] as const;

/** Tables protected by append-only triggers. */
export const APPEND_ONLY_TABLES = [
  "consent_records",
  "audit_logs",
  "policy_decisions",
  "admin_actions",
] as const;
