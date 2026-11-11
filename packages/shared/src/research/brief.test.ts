import { describe, expect, test } from "vitest";
import { forbiddenPhrases, researchBriefV1, type ResearchBriefV1 } from "./brief";
import { researchContextRequest } from "../extension/messages";

const valid: ResearchBriefV1 = {
  schemaVersion: "brief.v1",
  entity: { canonicalId: "ent:nvidia", name: "NVIDIA", ticker: "NVDA", instrumentId: null },
  summary: "NVIDIA designs GPUs used for gaming and data centers.",
  businessModel: [
    {
      id: "c1",
      text: "Most revenue comes from data center products.",
      kind: "fact",
      sourceIds: ["s1"],
    },
  ],
  financialHighlights: [
    {
      id: "c2",
      text: "Quarterly revenue",
      kind: "fact",
      sourceIds: ["s1"],
      metric: "revenue",
      value: "1000.5",
      unit: "million",
      currency: "USD",
      period: "FY2026 Q2",
      asOf: "2026-08-27",
      basis: "reported",
      formula: null,
    },
  ],
  valuation: [],
  industryContext: [],
  baseCase: [],
  recentDevelopments: [],
  competitors: [],
  bullCase: [],
  bearCase: [{ id: "c3", text: "Customer concentration.", kind: "analysis", sourceIds: ["s1"] }],
  risks: [{ id: "c4", text: "Export restrictions.", kind: "fact", sourceIds: ["s1"] }],
  openQuestions: [],
  sources: [
    {
      id: "s1",
      title: "10-Q",
      url: "https://www.sec.gov/x",
      publisher: "SEC EDGAR",
      publishedAt: null,
      retrievedAt: "2026-11-10T00:00:00Z",
    },
  ],
  dataFreshness: "fresh",
  disclaimer: "Educational research, not investment advice.",
  generation: {
    model: "test-model",
    provider: "test",
    promptVersion: "p1",
    generatedAt: "2026-11-10T00:00:00Z",
  },
};

describe("research brief v1", () => {
  test("a fully cited brief validates", () => {
    expect(researchBriefV1.parse(valid)).toBeTruthy();
  });
  test("claims citing a source that was not retrieved are rejected", () => {
    const bad = { ...valid, risks: [{ id: "c4", text: "x", kind: "fact", sourceIds: ["s9"] }] };
    expect(researchBriefV1.safeParse(bad).success).toBe(false);
  });
  test("uncited claims, missing bear case and float values are rejected", () => {
    expect(
      researchBriefV1.safeParse({
        ...valid,
        risks: [{ id: "c4", text: "x", kind: "fact", sourceIds: [] }],
      }).success,
    ).toBe(false);
    expect(researchBriefV1.safeParse({ ...valid, bearCase: [] }).success).toBe(false);
    const fig = { ...valid.financialHighlights[0], value: 1000.5 };
    expect(researchBriefV1.safeParse({ ...valid, financialHighlights: [fig] }).success).toBe(false);
  });
  test("forbidden certainty language is detected", () => {
    expect(
      forbiddenPhrases({ ...valid, summary: "A guaranteed winner, strong buy now." }),
    ).toHaveLength(1);
    expect(forbiddenPhrases(valid)).toEqual([]);
    const fig = { ...valid.financialHighlights[0]!, text: "Risk-free growth" };
    expect(forbiddenPhrases({ ...valid, financialHighlights: [fig] })).toEqual([
      "Risk-free growth",
    ]);
    expect(
      forbiddenPhrases({ ...valid, openQuestions: ["Is this a guaranteed win?"] }),
    ).toHaveLength(1);
  });
});

describe("extension research context", () => {
  test("requires explicit user confirmation and limits the excerpt", () => {
    const base = { entityId: "ent:nvidia", sourceUrl: "https://x.com/post/1", userConfirmed: true };
    expect(researchContextRequest.safeParse(base).success).toBe(true);
    expect(researchContextRequest.safeParse({ ...base, userConfirmed: false }).success).toBe(false);
    expect(
      researchContextRequest.safeParse({ ...base, selectedExcerpt: "x".repeat(2001) }).success,
    ).toBe(false);
    expect(researchContextRequest.safeParse({ ...base, pageText: "..." }).success).toBe(false);
  });
});
