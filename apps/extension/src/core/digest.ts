/**
 * Local-only daily digest (PRD §5.3). Built ONLY from intentional actions, never passive time.
 * Every item records why it appeared. Pure; the caller persists to chrome.storage.local.
 */
export type DigestKind =
  "acknowledged" | "panel_opened" | "research_requested" | "watchlist_added" | "saved_for_later";

export const DIGEST_GROUPS: Record<DigestKind, string> = {
  acknowledged: "Companies you noticed",
  saved_for_later: "Saved for later",
  panel_opened: "Research panels opened",
  research_requested: "Research requested",
  watchlist_added: "Watchlist changes",
};

const WHY: Record<DigestKind, string> = {
  acknowledged: "You acted on a detection notification",
  saved_for_later: "You chose “Save for later” on a notification",
  panel_opened: "You opened the research panel",
  research_requested: "You confirmed an AI research request",
  watchlist_added: "You added it to your watchlist",
};

export interface DigestItem {
  id: string;
  kind: DigestKind;
  entityId: string;
  entityName: string;
  /** Domain only (never the full URL, never page text). */
  domain: string | null;
  at: number;
  why: string;
}

export interface DigestSettings {
  enabled: boolean;
  /** "HH:MM" local time. */
  deliveryTime: string;
  timezone: string;
  retentionDays: number;
}

export const DEFAULT_DIGEST: DigestSettings = {
  enabled: false,
  deliveryTime: "18:00",
  timezone: "UTC",
  retentionDays: 30,
};

export function makeItem(
  kind: DigestKind,
  entity: { id: string; name: string },
  domain: string | null,
  now: number,
  id: string,
): DigestItem {
  return {
    id,
    kind,
    entityId: entity.id,
    entityName: entity.name,
    domain,
    at: now,
    why: WHY[kind],
  };
}

export function addItem(items: DigestItem[], item: DigestItem): DigestItem[] {
  // Collapse duplicates of the same action for the same entity within an hour.
  const dup = items.some(
    (i) => i.kind === item.kind && i.entityId === item.entityId && item.at - i.at < 3_600_000,
  );
  return dup ? items : [...items, item].slice(-500);
}

export function purge(items: DigestItem[], now: number, retentionDays: number): DigestItem[] {
  const cutoff = now - retentionDays * 86_400_000;
  return items.filter((i) => i.at >= cutoff);
}

export function group(
  items: DigestItem[],
): { kind: DigestKind; title: string; items: DigestItem[] }[] {
  return (Object.keys(DIGEST_GROUPS) as DigestKind[])
    .map((kind) => ({
      kind,
      title: DIGEST_GROUPS[kind],
      items: items.filter((i) => i.kind === kind).sort((a, b) => b.at - a.at),
    }))
    .filter((g) => g.items.length > 0);
}

/** Next delivery time (epoch ms) for "HH:MM" in the given IANA timezone. */
export function nextDelivery(now: number, deliveryTime: string, timezone: string): number {
  const [hh, mm] = deliveryTime.split(":").map((x) => Number(x));
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
    .formatToParts(new Date(now))
    .reduce<Record<string, number>>(
      (acc, p) => (p.type !== "literal" ? { ...acc, [p.type]: Number(p.value) } : acc),
      {},
    );
  const localNowAsUtc = Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour!,
    parts.minute!,
    parts.second!,
  );
  const offset = localNowAsUtc - now;
  let target = Date.UTC(parts.year!, parts.month! - 1, parts.day!, hh ?? 18, mm ?? 0) - offset;
  if (target <= now) target += 86_400_000;
  return target;
}
