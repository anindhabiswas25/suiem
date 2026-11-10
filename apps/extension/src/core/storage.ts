import type { DigestItem, DigestSettings } from "./digest";
import { DEFAULT_DIGEST } from "./digest";
import { DEFAULT_RATE_LIMITS, type NotifyEvent, type RateLimits } from "./ratelimit";
import { deleteSecret, getSecret, setSecret } from "./secrets";
import { INITIAL_STATE, type Mode, type PrivacyState } from "./state";

/**
 * Typed chrome.storage wrappers. Persistent data lives in storage.local; per-session privacy
 * (private tabs, private session) lives in storage.session so it ends with the browser session.
 */
export interface Settings {
  /** Hostnames the user granted (each backed by a host permission). */
  sites: string[];
  mutedEntities: string[];
  mutedSites: string[];
  notifyThreshold: number;
  rateLimits: RateLimits;
  digest: DigestSettings;
}

export interface Auth {
  token: string;
  installationId: string;
  handle: string;
}

export interface SavedItem {
  entityId: string;
  name: string;
  at: number;
}

export interface PanelContext {
  entityId?: string;
  sourceUrl?: string;
  why?: string;
  /** Selected text (local only; sent only if the user ticks "include my selected text"). */
  selection?: string;
  at: number;
}

export const DEFAULT_SETTINGS: Settings = {
  sites: [],
  mutedEntities: [],
  mutedSites: [],
  notifyThreshold: 0.8,
  rateLimits: DEFAULT_RATE_LIMITS,
  digest: DEFAULT_DIGEST,
};

async function getLocal<T>(key: string, fallback: T): Promise<T> {
  const r = await chrome.storage.local.get(key);
  return (r[key] as T | undefined) ?? fallback;
}
const setLocal = (key: string, value: unknown) => chrome.storage.local.set({ [key]: value });

export async function loadState(): Promise<PrivacyState> {
  const persisted = await getLocal<{ mode: Mode; privateSites: string[] }>("state", {
    mode: INITIAL_STATE.mode,
    privateSites: [],
  });
  const session = (await chrome.storage.session.get(["privateTabs", "privateSession"])) as {
    privateTabs?: number[];
    privateSession?: boolean;
  };
  return {
    mode: persisted.mode,
    privateSites: persisted.privateSites,
    privateTabs: session.privateTabs ?? [],
    privateSession: session.privateSession ?? false,
  };
}

export async function saveState(state: PrivacyState): Promise<void> {
  await setLocal("state", { mode: state.mode, privateSites: state.privateSites });
  await chrome.storage.session.set({
    privateTabs: state.privateTabs,
    privateSession: state.privateSession,
  });
}

export async function loadSettings(): Promise<Settings> {
  const s = await getLocal<Partial<Settings>>("settings", {});
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    digest: { ...DEFAULT_DIGEST, ...(s.digest ?? {}) },
    rateLimits: { ...DEFAULT_RATE_LIMITS, ...(s.rateLimits ?? {}) },
  };
}
export const saveSettings = (s: Settings) => setLocal("settings", s);

/** The device token is kept out of chrome.storage (content scripts can read storage.local). */
export async function loadAuth(): Promise<Auth | null> {
  // One-time migration: pre-release builds kept the token in storage.local. Move it, then delete it.
  const legacy = (await chrome.storage.local.get("auth")).auth as Auth | undefined;
  if (legacy) {
    await setSecret("auth", legacy);
    await chrome.storage.local.remove("auth");
  }
  return (await getSecret<Auth>("auth")) ?? null;
}
export async function saveAuth(a: Auth | null): Promise<void> {
  await chrome.storage.local.remove("auth");
  if (a) await setSecret("auth", a);
  else await deleteSecret("auth");
}

export const loadDigest = () => getLocal<DigestItem[]>("digest", []);
export const saveDigest = (items: DigestItem[]) => setLocal("digest", items);

export const loadHistory = () => getLocal<NotifyEvent[]>("notifyHistory", []);
export const saveHistory = (h: NotifyEvent[]) => setLocal("notifyHistory", h);

export const loadSaved = () => getLocal<SavedItem[]>("savedForLater", []);
export const saveSaved = (items: SavedItem[]) => setLocal("savedForLater", items);

export async function loadPanelContext(tabId: number | "window"): Promise<PanelContext | null> {
  const key = `panel:${tabId}`;
  const r = await chrome.storage.session.get(key);
  return (r[key] as PanelContext | undefined) ?? null;
}
export const savePanelContext = (tabId: number | "window", ctx: PanelContext) =>
  chrome.storage.session.set({ [`panel:${tabId}`]: ctx });

/** Deletes every piece of local activity (digest, rate history, saved items, panel contexts). */
export async function clearLocalActivity(): Promise<void> {
  await chrome.storage.local.remove(["digest", "notifyHistory", "savedForLater"]);
  const all = await chrome.storage.session.get(null);
  await chrome.storage.session.remove(Object.keys(all).filter((k) => k.startsWith("panel:")));
}
