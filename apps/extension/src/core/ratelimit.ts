/**
 * Notification rate limits (PRD §6.4): at most once per entity per `perEntityMinutes`, and at most
 * `perDomainPerHour` notifications per domain per hour. Pure; history is stored by the caller.
 */
export interface RateLimits {
  perEntityMinutes: number;
  perDomainPerHour: number;
}
export const DEFAULT_RATE_LIMITS: RateLimits = { perEntityMinutes: 30, perDomainPerHour: 3 };

export interface NotifyEvent {
  entityId: string;
  domain: string;
  at: number;
}

const HOUR = 3_600_000;

export function shouldNotify(
  history: NotifyEvent[],
  event: Omit<NotifyEvent, "at">,
  now: number,
  limits: RateLimits = DEFAULT_RATE_LIMITS,
): boolean {
  const entityWindow = limits.perEntityMinutes * 60_000;
  if (history.some((h) => h.entityId === event.entityId && now - h.at < entityWindow)) return false;
  const domainCount = history.filter((h) => h.domain === event.domain && now - h.at < HOUR).length;
  return domainCount < limits.perDomainPerHour;
}

/** Keeps only events that can still affect a decision. */
export function prune(
  history: NotifyEvent[],
  now: number,
  limits: RateLimits = DEFAULT_RATE_LIMITS,
): NotifyEvent[] {
  const keep = Math.max(limits.perEntityMinutes * 60_000, HOUR);
  return history.filter((h) => now - h.at < keep).slice(-200);
}
