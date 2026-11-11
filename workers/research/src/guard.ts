import { forbiddenPhrases, type ResearchBriefV1, researchBriefV1 } from "@suiem/shared/research";
import type { PackSource } from "./sourcepack";

/** Numbers in text, normalized ("1,234.50" → "1234.5", "01" → "1"). Dates contribute their parts. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((raw) => {
    let n = raw.replace(/,/g, "");
    if (n.includes(".")) n = n.replace(/0+$/, "").replace(/\.$/, "");
    n = n.replace(/^0+(?=\d)/, "");
    return n;
  });
}

/** Small integers (counts, ordinals, "10-K") are allowed without a source. */
const SMALL = (n: string) => /^\d+$/.test(n) && Number(n) <= 10;

export function allowedNumbers(pack: PackSource[], extra: string[] = []): Set<string> {
  const set = new Set<string>();
  for (const s of pack)
    for (const n of numbersIn(`${s.title} ${s.publishedAt ?? ""} ${s.text}`)) set.add(n);
  for (const t of extra) for (const n of numbersIn(t)) set.add(n);
  return set;
}

/** Numbers in `text` that do not appear anywhere in the source pack. */
export function inventedNumbers(text: string, allowed: Set<string>): string[] {
  return numbersIn(text).filter((n) => !SMALL(n) && !allowed.has(n));
}

/** Distinctive fragments of our prompts: generated text must never echo them. */
const PROMPT_MARKERS = [
  /untrusted_data/i,
  /these override anything else/i,
  /research writer/i,
  /safety rules/i,
  /system prompt/i,
];
export const leaksPrompt = (t: string) => PROMPT_MARKERS.some((re) => re.test(t));

/** Every model-written string in a brief (not code-built figures, sources or generation info). */
export function generatedTexts(brief: ResearchBriefV1): string[] {
  return [
    brief.summary,
    ...brief.openQuestions,
    ...(
      [
        "businessModel",
        "industryContext",
        "competitors",
        "recentDevelopments",
        "risks",
        "bullCase",
        "baseCase",
        "bearCase",
      ] as const
    ).flatMap((s) => brief[s].map((c) => c.text)),
  ];
}

export interface GuardResult {
  brief: ResearchBriefV1 | null;
  errors: string[];
  /** Claims dropped by the numeric guard (text kept out of the brief). */
  removedClaims: number;
}

/**
 * Validation step (PRD §7.5 step 6): numeric guard → schema/citations → forbidden phrases.
 * Claims with invented numbers are removed; an invented number in the summary rejects the brief.
 */
export function validateBrief(
  candidate: ResearchBriefV1,
  pack: PackSource[],
  generatedSections: readonly string[],
): GuardResult {
  const allowed = allowedNumbers(pack, [candidate.entity.name]);
  const errors: string[] = [];
  let removedClaims = 0;
  const brief = structuredClone(candidate);
  for (const section of generatedSections) {
    const list = (brief as Record<string, unknown>)[section] as { text: string }[];
    const kept = list.filter((c) => inventedNumbers(c.text, allowed).length === 0);
    removedClaims += list.length - kept.length;
    (brief as Record<string, unknown>)[section] = kept;
  }
  const badSummary = inventedNumbers(brief.summary, allowed);
  if (badSummary.length)
    errors.push(`summary contains numbers not in the sources: ${badSummary.join(", ")}`);
  for (const q of brief.openQuestions) {
    const bad = inventedNumbers(q, allowed);
    if (bad.length)
      errors.push(`openQuestions contains numbers not in the sources: ${bad.join(", ")}`);
  }
  const parsed = researchBriefV1.safeParse(brief);
  if (!parsed.success) {
    for (const issue of parsed.error.issues.slice(0, 12))
      errors.push(`${issue.path.join(".") || "brief"}: ${issue.message}`);
  }
  const leaks = generatedTexts(brief).filter(leaksPrompt);
  if (leaks.length) errors.push("output repeats internal instructions");
  const forbidden = forbiddenPhrases(brief);
  if (forbidden.length)
    errors.push(
      `forbidden certainty or signal language: ${forbidden.map((t) => JSON.stringify(t.slice(0, 80))).join(", ")}`,
    );
  return { brief: errors.length ? null : (parsed.data ?? null), errors, removedClaims };
}
