import { Inject, Injectable } from "@nestjs/common";
import { stockTokenEligibility } from "@suiem/config/jurisdictions";
import { type DbHandle, schema } from "@suiem/db";
import {
  CONSENT_PURPOSES,
  type ConsentPurpose,
  type ConsentRecord,
  type CurrentPolicyVersions,
  checkTransition,
  deriveConsentState,
  hasRequiredConsents,
  NOT_YET_AVAILABLE,
  REQUIRED_PURPOSES,
} from "@suiem/shared/consent";
import { newId } from "@suiem/shared/ids";
import type { MeResponse, PatchMeRequest } from "@suiem/shared/schemas";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getAddress } from "viem";
import { ApiError } from "../http/errors";
import { DB } from "../tokens";

/**
 * Everything here is scoped to the session's user id: every query filters on it
 * (full RLS deferred, ADR-0010 §5; covered by me.int.test.ts cross-user tests).
 */
@Injectable()
export class MeService {
  constructor(@Inject(DB) private readonly db: DbHandle) {}

  async currentPolicies(): Promise<
    Map<ConsentPurpose, { version: string; title: string; summaryUrl: string }>
  > {
    const rows = await this.db.db
      .select()
      .from(schema.policyVersions)
      .orderBy(desc(schema.policyVersions.publishedAt));
    const out = new Map<ConsentPurpose, { version: string; title: string; summaryUrl: string }>();
    for (const r of rows)
      if (!out.has(r.purpose as ConsentPurpose))
        out.set(r.purpose as ConsentPurpose, {
          version: r.version,
          title: r.title,
          summaryUrl: r.summaryUrl,
        });
    return out;
  }

  async consentState(userId: string) {
    const policies = await this.currentPolicies();
    const current = Object.fromEntries(
      CONSENT_PURPOSES.map((p) => [p, policies.get(p)?.version ?? "0000-00-00.0"]),
    ) as CurrentPolicyVersions;
    const rows = await this.db.db
      .select()
      .from(schema.consentRecords)
      .where(eq(schema.consentRecords.userId, userId));
    const records: ConsentRecord[] = rows.map((r) => ({
      purpose: r.purpose as ConsentPurpose,
      policyVersion: r.policyVersion,
      action: r.action,
      recordedAt: r.recordedAt.toISOString(),
    }));
    return { state: deriveConsentState(records, current), policies };
  }

  async consents(userId: string) {
    const { state, policies } = await this.consentState(userId);
    return {
      items: CONSENT_PURPOSES.map((p) => ({
        ...state[p],
        required: REQUIRED_PURPOSES.includes(p),
        available: !NOT_YET_AVAILABLE.includes(p),
        title: policies.get(p)?.title ?? p,
        summaryUrl: policies.get(p)?.summaryUrl ?? "/help",
      })),
    };
  }

  async recordConsent(
    userId: string,
    event: { purpose: ConsentPurpose; action: "granted" | "withdrawn"; policyVersion: string },
  ) {
    const { state } = await this.consentState(userId);
    const check = checkTransition(state, event);
    if (!check.ok) throw new ApiError(check.code, check.reason);
    await this.db.db.insert(schema.consentRecords).values({
      id: newId(),
      userId,
      purpose: event.purpose,
      policyVersion: event.policyVersion,
      action: event.action,
      source: "web",
    });
    return this.consents(userId);
  }

  async me(userId: string): Promise<MeResponse> {
    const user = (
      await this.db.db.select().from(schema.users).where(eq(schema.users.id, userId))
    )[0];
    const prefs = (
      await this.db.db
        .select()
        .from(schema.userPreferences)
        .where(eq(schema.userPreferences.userId, userId))
    )[0];
    if (!user || !prefs) throw new ApiError("UNAUTHENTICATED", "Sign in required");
    const methods = await this.db.db
      .select({ kind: schema.authMethods.kind })
      .from(schema.authMethods)
      .where(and(eq(schema.authMethods.userId, userId), isNull(schema.authMethods.revokedAt)));
    const wallets = await this.wallets(userId);
    const { state } = await this.consentState(userId);
    return {
      id: user.id,
      handle: user.handle,
      displayName: user.displayName,
      jurisdiction: prefs.jurisdiction,
      experienceLevel: prefs.experienceLevel as MeResponse["experienceLevel"],
      researchDepth: prefs.researchDepth as MeResponse["researchDepth"],
      interests: prefs.interests as MeResponse["interests"],
      interestsSkipped: prefs.interestsSkipped,
      onboardingCompletedAt: prefs.onboardingCompletedAt?.toISOString() ?? null,
      authMethods: [...new Set(methods.map((m) => m.kind))],
      passkeyCount: methods.filter((m) => m.kind === "passkey").length,
      wallets: wallets.items,
      requiredConsentsGranted: hasRequiredConsents(state),
      stockTokenEligible: stockTokenEligibility(prefs.jurisdiction).eligible,
    };
  }

  async patch(userId: string, patch: PatchMeRequest): Promise<MeResponse> {
    if (patch.onboardingCompleted) {
      const { state } = await this.consentState(userId);
      if (!hasRequiredConsents(state))
        throw new ApiError(
          "CONSENT_REQUIRED",
          "Accept the terms and privacy notice to finish onboarding",
        );
    }
    await this.db.db.transaction(async (tx) => {
      if (patch.displayName !== undefined) {
        await tx
          .update(schema.users)
          .set({ displayName: patch.displayName })
          .where(eq(schema.users.id, userId));
      }
      const prefs: Partial<typeof schema.userPreferences.$inferInsert> = {};
      if (patch.jurisdiction !== undefined) prefs.jurisdiction = patch.jurisdiction;
      if (patch.experienceLevel !== undefined) prefs.experienceLevel = patch.experienceLevel;
      if (patch.researchDepth !== undefined) prefs.researchDepth = patch.researchDepth;
      if (patch.interests !== undefined) {
        prefs.interests = [...new Set(patch.interests)];
        prefs.interestsSkipped = false;
      }
      if (patch.interestsSkipped !== undefined) prefs.interestsSkipped = patch.interestsSkipped;
      if (patch.onboardingCompleted) prefs.onboardingCompletedAt = new Date();
      if (Object.keys(prefs).length > 0)
        await tx
          .update(schema.userPreferences)
          .set(prefs)
          .where(eq(schema.userPreferences.userId, userId));
    });
    return this.me(userId);
  }

  async wallets(userId: string) {
    const rows = await this.db.db
      .select()
      .from(schema.walletAccounts)
      .where(
        and(eq(schema.walletAccounts.userId, userId), isNull(schema.walletAccounts.unlinkedAt)),
      );
    return {
      items: rows.map((w) => ({
        id: w.id,
        chainId: w.chainId,
        address: getAddress(`0x${w.address.toString("hex")}`),
        linkedAt: w.linkedAt.toISOString(),
      })),
    };
  }

  /** Unlinks only the caller's own wallet. Keeps at least one login method. */
  async unlinkWallet(userId: string, walletId: string): Promise<void> {
    const methods = await this.db.db
      .select({
        kind: schema.authMethods.kind,
        walletAccountId: schema.authMethods.walletAccountId,
      })
      .from(schema.authMethods)
      .where(and(eq(schema.authMethods.userId, userId), isNull(schema.authMethods.revokedAt)));
    if (!methods.some((m) => m.walletAccountId === walletId))
      throw new ApiError("NOT_FOUND", "Wallet not found");
    if (methods.length <= 1)
      throw new ApiError(
        "CONFLICT",
        "Add a passkey or another wallet before removing your only login method",
      );
    const now = new Date();
    await this.db.db.transaction(async (tx) => {
      await tx
        .update(schema.walletAccounts)
        .set({ unlinkedAt: now })
        .where(
          and(eq(schema.walletAccounts.id, walletId), eq(schema.walletAccounts.userId, userId)),
        );
      await tx
        .update(schema.authMethods)
        .set({ revokedAt: now })
        .where(
          and(
            eq(schema.authMethods.walletAccountId, walletId),
            eq(schema.authMethods.userId, userId),
          ),
        );
    });
  }
}
