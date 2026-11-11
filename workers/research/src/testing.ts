/** Test helpers: offline fixture fetcher for EDGAR/Finnhub and a scriptable ResearchModel. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { GenerateInput, GenerateOutput, ResearchModel } from "./models/types";
import { ModelError } from "./models/types";

const FIXTURES = join(import.meta.dirname, "..", "fixtures");
const load = (name: string) => readFileSync(join(FIXTURES, `${name}.json`), "utf8");
const json = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "application/json" } });

export interface RecordedCall {
  url: string;
  headers: Record<string, string>;
}

/** Serves recorded fixtures for the URLs our adapters call. Unknown URLs → 404. Records headers. */
export function fixtureFetcher(calls: RecordedCall[] = []) {
  return async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({
      url,
      headers: Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)),
    });
    const u = new URL(url);
    try {
      let m = /\/api\/xbrl\/companyfacts\/CIK(\d{10})\.json$/.exec(u.pathname);
      if (m) {
        const body = load(`edgar-facts-${m[1]}`);
        // The foreign filer fixture has no us-gaap facts; real EDGAR may also 404.
        return json(body);
      }
      m = /\/submissions\/CIK(\d{10})\.json$/.exec(u.pathname);
      if (m) {
        const filings = JSON.parse(load(`edgar-filings-${m[1]}`)) as Record<string, string>[];
        const cols = ["accessionNumber", "form", "filingDate", "reportDate", "primaryDocument"];
        return json(
          JSON.stringify({
            filings: { recent: Object.fromEntries(cols.map((c) => [c, filings.map((f) => f[c])])) },
          }),
        );
      }
      const sym = u.searchParams.get("symbol") ?? "";
      if (u.pathname.endsWith("/stock/profile2")) return json(load(`finnhub-profile-${sym}`));
      if (u.pathname.endsWith("/quote")) return json(load(`finnhub-quote-${sym}`));
      if (u.pathname.endsWith("/stock/peers")) return json(load(`finnhub-peers-${sym}`));
      if (u.pathname.endsWith("/stock/metric"))
        return json(JSON.stringify({ metric: JSON.parse(load(`finnhub-metric-${sym}`)) }));
      if (u.pathname.endsWith("/company-news")) return json(load(`finnhub-news-${sym}`));
    } catch {
      return json("{}", 404);
    }
    return json("{}", 404);
  };
}

type Step = unknown | ((input: GenerateInput) => unknown);

/** A ResearchModel that replays scripted outputs (or throws ModelErrors). */
export class MockModel implements ResearchModel {
  readonly calls: GenerateInput[] = [];
  constructor(
    readonly provider: "groq" | "gemini" | "mock",
    readonly model: string,
    private readonly steps: Step[],
  ) {}
  async generate(input: GenerateInput): Promise<GenerateOutput> {
    this.calls.push(input);
    const step = this.steps[Math.min(this.calls.length - 1, this.steps.length - 1)];
    const v = typeof step === "function" ? (step as (i: GenerateInput) => unknown)(input) : step;
    if (v instanceof ModelError) throw v;
    return { json: structuredClone(v), tokens: 1000 };
  }
}

export const rateLimited = (provider: string) =>
  new ModelError(provider, "rate_limit", `${provider} rate limit (429)`);

/** A well-formed narrative citing only the given source IDs. */
export function goodNarrative(ids: string[] = ["s1", "s3"]) {
  const a = ids[0]!;
  const b = ids[1] ?? a;
  return {
    summary:
      "NVIDIA designs accelerated computing chips and software. Its latest annual filing reports strong data center demand, while competition and export rules are key risks.",
    businessModel: [
      {
        text: "NVIDIA sells GPUs, systems and software for data centers, gaming and other markets.",
        kind: "fact",
        sourceIds: [b],
      },
    ],
    industryContext: [
      { text: "The company operates in the semiconductor industry.", kind: "fact", sourceIds: [b] },
    ],
    competitors: [
      { text: "Finnhub lists other chip designers as peers.", kind: "fact", sourceIds: [b] },
    ],
    recentDevelopments: [],
    risks: [
      {
        text: "Demand for data center chips could slow if customers cut spending.",
        kind: "analysis",
        sourceIds: [a],
      },
      {
        text: "Competition from other chip designers could pressure margins.",
        kind: "analysis",
        sourceIds: [b],
      },
    ],
    bullCase: [
      {
        text: "Continued data center demand could support revenue.",
        kind: "analysis",
        sourceIds: [a],
      },
    ],
    baseCase: [
      {
        text: "Growth could moderate from recent levels as comparisons get harder.",
        kind: "analysis",
        sourceIds: [a],
      },
    ],
    bearCase: [
      {
        text: "A spending pullback by large customers would weigh on results.",
        kind: "analysis",
        sourceIds: [a],
      },
    ],
    openQuestions: ["How durable is data center demand?"],
  };
}
