/**
 * Research text checks: normalisation, word shingles and Jaccard similarity (near-duplicates
 * earn zero quality, PRD §10.3 "copied content is penalized"). Pure and deterministic.
 */
import { div, PPM } from "./fixed";

export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Set of k-word shingles. Short texts fall back to the whole normalised text. */
export function shingles(text: string, k: number): Set<string> {
  const words = normalizeText(text).split(" ").filter(Boolean);
  const out = new Set<string>();
  if (words.length < k) {
    if (words.length) out.add(words.join(" "));
    return out;
  }
  for (let i = 0; i + k <= words.length; i++) out.add(words.slice(i, i + k).join(" "));
  return out;
}

/** Jaccard similarity of two shingle sets, in ppm. */
export function jaccardPpm(a: Set<string>, b: Set<string>): bigint {
  if (a.size === 0 && b.size === 0) return 0n;
  let inter = 0;
  for (const s of a) if (b.has(s)) inter++;
  const union = a.size + b.size - inter;
  return div(BigInt(inter) * PPM, BigInt(union));
}

/** Length after whitespace normalisation (characters). */
export function textLength(text: string): number {
  return text.replace(/\s+/g, " ").trim().length;
}
