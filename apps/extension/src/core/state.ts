/**
 * Extension privacy state machine (PRD §5.7, ADR-0003 §1). Pure: no chrome.* calls.
 * Base mode: on | paused{until} | off. PRIVATE is an overlay that excludes a tab, a site or the
 * whole session from detection and history. Only `isActive` + `allowsContext` decide whether any
 * work may happen; the worker applies the result to content scripts, alarms and the network.
 */
export type Mode = { kind: "on" } | { kind: "paused"; until: number } | { kind: "off" };

export interface PrivacyState {
  mode: Mode;
  /** Tabs excluded until closed. */
  privateTabs: number[];
  /** Hostnames excluded until removed (persisted). */
  privateSites: string[];
  /** Whole browser session excluded until the browser restarts. */
  privateSession: boolean;
}

export const INITIAL_STATE: PrivacyState = {
  mode: { kind: "on" },
  privateTabs: [],
  privateSites: [],
  privateSession: false,
};

export type PauseChoice = { kind: "minutes"; minutes: number } | { kind: "untilTomorrow" };

export type StateEvent =
  | { type: "turnOn" }
  | { type: "turnOff" }
  | { type: "pause"; choice: PauseChoice }
  | { type: "tick" }
  | { type: "privateTab"; tabId: number; on: boolean }
  | { type: "tabClosed"; tabId: number }
  | { type: "privateSite"; host: string; on: boolean }
  | { type: "privateSession"; on: boolean };

export const PAUSE_PRESETS: { label: string; choice: PauseChoice }[] = [
  { label: "30 minutes", choice: { kind: "minutes", minutes: 30 } },
  { label: "1 hour", choice: { kind: "minutes", minutes: 60 } },
  { label: "Until tomorrow", choice: { kind: "untilTomorrow" } },
];

/** Next local midnight after `now` (timezone offset injectable for tests). */
export function nextMidnight(
  now: number,
  tzOffsetMinutes = new Date(now).getTimezoneOffset(),
): number {
  const local = now - tzOffsetMinutes * 60_000;
  const day = 86_400_000;
  return Math.floor(local / day) * day + day + tzOffsetMinutes * 60_000;
}

export function normalizeHost(input: string): string | null {
  const raw =
    input
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .split(/[/?#]/)[0] ?? "";
  const host = raw.replace(/^www\./, "").replace(/:\d+$/, "");
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host) ||
    host === "localhost" ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host)
    ? host
    : null;
}

export function reduce(
  state: PrivacyState,
  event: StateEvent,
  now: number,
  tzOffsetMinutes?: number,
): PrivacyState {
  switch (event.type) {
    case "turnOn":
      return { ...state, mode: { kind: "on" } };
    case "turnOff":
      return { ...state, mode: { kind: "off" } };
    case "pause": {
      const until =
        event.choice.kind === "untilTomorrow"
          ? nextMidnight(now, tzOffsetMinutes)
          : now + Math.max(1, Math.min(event.choice.minutes, 7 * 24 * 60)) * 60_000;
      return { ...state, mode: { kind: "paused", until } };
    }
    case "tick":
      return state.mode.kind === "paused" && now >= state.mode.until
        ? { ...state, mode: { kind: "on" } }
        : state;
    case "privateTab": {
      const tabs = new Set(state.privateTabs);
      if (event.on) tabs.add(event.tabId);
      else tabs.delete(event.tabId);
      return { ...state, privateTabs: [...tabs] };
    }
    case "tabClosed":
      return { ...state, privateTabs: state.privateTabs.filter((t) => t !== event.tabId) };
    case "privateSite": {
      const host = normalizeHost(event.host);
      if (!host) return state;
      const sites = new Set(state.privateSites);
      if (event.on) sites.add(host);
      else sites.delete(host);
      return { ...state, privateSites: [...sites].sort() };
    }
    case "privateSession":
      return { ...state, privateSession: event.on };
  }
}

/** True only when ON (or a pause has expired) and the session is not private. */
export function isActive(state: PrivacyState, now: number): boolean {
  if (state.privateSession) return false;
  if (state.mode.kind === "on") return true;
  if (state.mode.kind === "paused") return now >= state.mode.until;
  return false;
}

export function hostMatches(host: string, site: string): boolean {
  return host === site || host.endsWith(`.${site}`);
}

/** Whether work may happen for a given tab/site right now. */
export function allowsContext(
  state: PrivacyState,
  now: number,
  ctx: { tabId?: number; host?: string },
): boolean {
  if (!isActive(state, now)) return false;
  if (ctx.tabId !== undefined && state.privateTabs.includes(ctx.tabId)) return false;
  if (ctx.host && state.privateSites.some((s) => hostMatches(ctx.host!, s))) return false;
  return true;
}

export function describe(
  state: PrivacyState,
  now: number,
): { label: string; icon: string; tone: "positive" | "warning" | "neutral" } {
  if (state.privateSession)
    return { label: "Private session: nothing is detected or saved", icon: "◐", tone: "warning" };
  if (state.mode.kind === "off")
    return { label: "Off: detection and network are stopped", icon: "○", tone: "neutral" };
  if (state.mode.kind === "paused" && now < state.mode.until) {
    return {
      label: `Paused until ${new Date(state.mode.until).toLocaleString()}`,
      icon: "⏸",
      tone: "warning",
    };
  }
  return { label: "On: detecting companies on your granted sites", icon: "●", tone: "positive" };
}
