import { describe, expect, test } from "vitest";
import {
  type ConsentRecord,
  type CurrentPolicyVersions,
  checkTransition,
  deriveConsentState,
  hasRequiredConsents,
} from "./index";

const current: CurrentPolicyVersions = {
  terms: "2026-11-10.1",
  privacy: "2026-11-10.1",
  product_analytics: "2026-11-10.1",
  marketing_email: "2026-11-10.1",
  extension_detection: "2026-11-10.1",
  digest_sync: "2026-11-10.1",
};
const rec = (
  purpose: ConsentRecord["purpose"],
  action: ConsentRecord["action"],
  v: string,
  t: string,
): ConsentRecord => ({
  purpose,
  action,
  policyVersion: v,
  recordedAt: `2026-11-10T00:00:0${t}Z`,
});

describe("consent state machine", () => {
  test("no records → not_asked everywhere, and required consents missing", () => {
    const s = deriveConsentState([], current);
    expect(Object.values(s).every((p) => p.status === "not_asked")).toBe(true);
    expect(hasRequiredConsents(s)).toBe(false);
  });

  test("granting terms and privacy satisfies the account requirement", () => {
    const s = deriveConsentState(
      [
        rec("terms", "granted", "2026-11-10.1", "1"),
        rec("privacy", "granted", "2026-11-10.1", "2"),
      ],
      current,
    );
    expect(hasRequiredConsents(s)).toBe(true);
    expect(s.terms.policyVersion).toBe("2026-11-10.1");
  });

  test("a newer published policy makes earlier consent outdated", () => {
    const s = deriveConsentState([rec("terms", "granted", "2026-01-01.1", "1")], current);
    expect(s.terms.status).toBe("outdated");
    expect(hasRequiredConsents(s)).toBe(false);
  });

  test("the latest record wins regardless of input order", () => {
    const s = deriveConsentState(
      [
        rec("marketing_email", "withdrawn", "2026-11-10.1", "3"),
        rec("marketing_email", "granted", "2026-11-10.1", "1"),
      ],
      current,
    );
    expect(s.marketing_email.status).toBe("withdrawn");
  });

  test("granting must use the current version", () => {
    const s = deriveConsentState([], current);
    expect(
      checkTransition(s, { purpose: "terms", action: "granted", policyVersion: "2025-01-01.1" }).ok,
    ).toBe(false);
    expect(
      checkTransition(s, { purpose: "terms", action: "granted", policyVersion: "2026-11-10.1" }).ok,
    ).toBe(true);
  });

  test("optional consent can be withdrawn; required consent cannot (account deletion instead)", () => {
    const s = deriveConsentState(
      [
        rec("terms", "granted", "2026-11-10.1", "1"),
        rec("product_analytics", "granted", "2026-11-10.1", "2"),
      ],
      current,
    );
    expect(
      checkTransition(s, {
        purpose: "product_analytics",
        action: "withdrawn",
        policyVersion: "2026-11-10.1",
      }).ok,
    ).toBe(true);
    const r = checkTransition(s, {
      purpose: "terms",
      action: "withdrawn",
      policyVersion: "2026-11-10.1",
    });
    expect(r).toMatchObject({ ok: false, code: "CONSENT_REQUIRED" });
  });

  test("cannot withdraw what was never granted, nor grant twice", () => {
    const s0 = deriveConsentState([], current);
    expect(
      checkTransition(s0, {
        purpose: "marketing_email",
        action: "withdrawn",
        policyVersion: "2026-11-10.1",
      }).ok,
    ).toBe(false);
    const s1 = deriveConsentState(
      [rec("marketing_email", "granted", "2026-11-10.1", "1")],
      current,
    );
    expect(
      checkTransition(s1, {
        purpose: "marketing_email",
        action: "granted",
        policyVersion: "2026-11-10.1",
      }).ok,
    ).toBe(false);
  });

  test("later-phase purposes cannot be granted yet", () => {
    const s = deriveConsentState([], current);
    expect(
      checkTransition(s, {
        purpose: "extension_detection",
        action: "granted",
        policyVersion: "2026-11-10.1",
      }).ok,
    ).toBe(false);
  });
});
