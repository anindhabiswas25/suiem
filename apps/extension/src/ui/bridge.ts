import type { DigestKind } from "../core/digest";
import type { PrivacyState, StateEvent } from "../core/state";
import type { Settings } from "../core/storage";

export interface Status {
  state: PrivacyState;
  description: { label: string; icon: string; tone: "positive" | "warning" | "neutral" };
  settings: Settings;
  grantedSites: string[];
  connected: { handle: string; installationId: string } | null;
  webOrigin: string;
}

/** Messages from extension pages to the worker. Errors come back as { error } and are thrown here. */
export async function send<T = Status>(msg: unknown): Promise<T> {
  const r = (await chrome.runtime.sendMessage(msg)) as (T & { error?: string }) | undefined;
  if (r && typeof r === "object" && "error" in r && r.error) throw new Error(r.error);
  return r as T;
}

export const getStatus = () => send<Status>({ type: "status" });
export const dispatch = (event: StateEvent) => send<Status>({ type: "event", event });
export const updateSettings = (patch: Partial<Settings>) =>
  send<Status>({ type: "settings", patch });
export const record = (kind: DigestKind, entityId: string, domain: string | null) =>
  send({ type: "record", kind, entityId, domain });

export async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");
