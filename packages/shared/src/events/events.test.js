import { describe, expect, test } from "vitest";
import { PRODUCT_EVENTS, computeWarc, validateEvent } from "./index";
describe("WARC event taxonomy", () => {
  test("only the PRD's meaningful research actions count toward WARC", () => {
    const counted = Object.entries(PRODUCT_EVENTS)
      .filter(([, d]) => d.countsTowardWarc)
      .map(([n]) => n)
      .sort();
    expect(counted).toEqual([
      "helpful_review_given",
      "research_brief_saved",
      "thesis_published",
      "thesis_review_completed",
    ]);
  });
  test("passive events never count", () => {
    expect(PRODUCT_EVENTS.research_panel_opened.countsTowardWarc).toBe(false);
    expect(PRODUCT_EVENTS.notification_shown.countsTowardWarc).toBe(false);
  });
  test("WARC counts unique users and honours exclusions (e.g. flagged automation)", () => {
    const events = [
      { name: "research_brief_saved", userId: "a" },
      { name: "thesis_published", userId: "a" },
      { name: "research_panel_opened", userId: "b" },
      { name: "research_brief_saved", userId: "c" },
    ];
    expect(computeWarc(events)).toBe(2);
    expect(computeWarc(events, new Set(["c"]))).toBe(1);
  });
  test("props are strict: PII-like extra fields are rejected", () => {
    expect(() =>
      validateEvent("account_created", { method: "email_otp", email: "a@b.c" }),
    ).toThrow();
    expect(() => validateEvent("wallet_linked", { chainId: 1 })).toThrow();
    expect(validateEvent("wallet_linked", { chainId: 46630 })).toEqual({ chainId: 46630 });
  });
});
