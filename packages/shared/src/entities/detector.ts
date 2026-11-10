import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  type AliasType,
  type DictionaryEntity,
  ENTITY_DICTIONARY,
  type EntityAlias,
  type EntityKind,
} from "./dictionary";

/**
 * Local entity detector (PRD §6.3). Pure: no I/O, deterministic for a given `now`.
 * It returns hashes of evidence spans, never the text itself. Only detections at or above
 * NOTIFY_THRESHOLD may produce a notification.
 */
export const NOTIFY_THRESHOLD = 0.8;
export const MIN_REPORTED_CONFIDENCE = 0.3;
const MAX_TEXT = 20_000;
const WINDOW = 80;

export type ContextCategory = "company_reference" | "possible_match" | "ambiguous";

export interface Detection {
  entityId: string;
  entityKind: EntityKind;
  candidateTickers: string[];
  confidence: number;
  contextCategory: ContextCategory;
  evidenceSpanHash: string;
  domain: string;
  detectedAt: string;
  ambiguityReason: string | null;
}

/** Words that indicate the text is about a company/security, not the ordinary meaning. */
const FINANCE_RE =
  /\b(stocks?|shares?|shareholders?|earnings|revenue|guidance|quarter(ly)?|Q[1-4]|fiscal|CEO|CFO|Inc\.?|Corp\.?|Corporation|NASDAQ|NYSE|ticker|market cap|valuation|dividends?|buyback|IPO|analysts?|price target|investors?|EPS|10-K|10-Q|SEC filing|downgrade|upgrade|rall(y|ied)|sell-?off|trading|traded)\b/i;
const FOOD_AFTER_RE =
  /^\s*(pies?|juice|cider|sauce|trees?|crumble|tarts?|orchards?|slices?|seeds?|picking)\b/i;
/** "my Tesla", "her new Apple" → a product, not the company (unless finance context says otherwise). */
const POSSESSIVE_BEFORE_RE = /\b(my|our|your|his|her|their|new|used|old)\s+$/i;

const BASE: Record<AliasType, number> = {
  cashtag: 0.95,
  legal_name: 0.95,
  exchange_symbol: 0.95,
  ticker: 0.85,
  name: 0.85,
  product: 0.6,
};

interface CompiledAlias {
  entity: DictionaryEntity;
  alias: EntityAlias;
  re: RegExp;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function compile(entity: DictionaryEntity, alias: EntityAlias): CompiledAlias {
  const body = escape(alias.alias);
  let re: RegExp;
  if (alias.type === "cashtag") {
    re = new RegExp(`(?<![A-Za-z0-9$])${body}(?![A-Za-z0-9])`, "gi");
  } else if (alias.type === "ticker") {
    // Tickers are case-sensitive and must not be part of a longer token or a cashtag.
    re = new RegExp(`(?<![A-Za-z0-9$.\\-])${body}(?![A-Za-z0-9\\-]|\\.[A-Za-z])`, "g");
  } else if (alias.ambiguous) {
    // Ordinary words: exact capitalisation, and not part of a hyphenated compound ("meta-analysis").
    re = new RegExp(`(?<![A-Za-z0-9\\-])${body}(?![A-Za-z0-9]|-[A-Za-z])`, "g");
  } else {
    re = new RegExp(`(?<![A-Za-z0-9\\-])${body}(?![A-Za-z0-9]|-[A-Za-z])`, "gi");
  }
  return { entity, alias, re };
}

const COMPILED: CompiledAlias[] = ENTITY_DICTIONARY.flatMap((e) =>
  e.aliases.map((a) => compile(e, a)),
);

export function spanHash(span: string): string {
  return bytesToHex(sha256(utf8ToBytes(span.trim().toLowerCase())));
}

interface Candidate {
  entity: DictionaryEntity;
  confidence: number;
  span: string;
  reason: string | null;
  strongSupport: boolean;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export function detect(text: string, options: { domain: string; now?: Date }): Detection[] {
  const input = text.slice(0, MAX_TEXT);
  const now = (options.now ?? new Date()).toISOString();
  const byEntity = new Map<string, Candidate[]>();

  for (const c of COMPILED) {
    c.re.lastIndex = 0;
    for (const m of input.matchAll(c.re)) {
      const start = m.index ?? 0;
      const span = m[0];
      const before = input.slice(Math.max(0, start - WINDOW), start);
      const after = input.slice(start + span.length, start + span.length + WINDOW);
      const context = `${before} ${after}`;
      const finance = FINANCE_RE.test(context);
      let confidence = BASE[c.alias.type];
      let reason: string | null = null;

      if (c.alias.ambiguous) {
        confidence = c.alias.type === "cashtag" ? 0.5 : 0.4;
        reason = `"${c.alias.type === "cashtag" ? "ticker" : "word"}" is also an ordinary word`;
        if (finance) {
          confidence = 0.85;
          reason = null;
        }
      } else if (finance) {
        confidence = Math.min(0.99, confidence + 0.05);
      }
      if (FOOD_AFTER_RE.test(after)) {
        confidence = Math.min(confidence, 0.2);
        reason = "food or everyday usage";
      } else if (
        !finance &&
        c.entity.kind === "company" &&
        POSSESSIVE_BEFORE_RE.test(before) &&
        c.alias.type === "name"
      ) {
        confidence = Math.min(confidence, 0.5);
        reason = "looks like a product mention, not the company";
      }
      const list = byEntity.get(c.entity.canonicalId) ?? [];
      list.push({
        entity: c.entity,
        confidence,
        span,
        reason,
        strongSupport: !c.alias.ambiguous && confidence >= 0.85,
      });
      byEntity.set(c.entity.canonicalId, list);
    }
  }

  const out: Detection[] = [];
  for (const candidates of byEntity.values()) {
    // An unambiguous, strong mention of the same entity supports weaker ambiguous ones.
    const supported = candidates.some((c) => c.strongSupport);
    const best = candidates.reduce((a, b) => (b.confidence > a.confidence ? b : a));
    const confidence = round(supported ? Math.max(best.confidence, 0.85) : best.confidence);
    if (confidence < MIN_REPORTED_CONFIDENCE) continue;
    const entity = best.entity;
    out.push({
      entityId: entity.canonicalId,
      entityKind: entity.kind,
      candidateTickers: entity.tickers.slice(0, 5),
      confidence,
      contextCategory:
        confidence >= NOTIFY_THRESHOLD
          ? "company_reference"
          : confidence >= 0.5
            ? "possible_match"
            : "ambiguous",
      evidenceSpanHash: spanHash(best.span),
      domain: options.domain.slice(0, 253),
      detectedAt: now,
      ambiguityReason: confidence >= NOTIFY_THRESHOLD ? null : (best.reason ?? "low confidence"),
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence);
}

/** Detections that may notify at the given threshold (default 0.8). */
export function notifiable(detections: Detection[], threshold = NOTIFY_THRESHOLD): Detection[] {
  return detections.filter((d) => d.confidence >= threshold);
}
