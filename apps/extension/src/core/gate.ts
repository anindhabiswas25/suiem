import { CONTENT_SCRIPT_ID, DIGEST_ALARM } from "./config";
import { nextDelivery } from "./digest";
import { isActive, reduce, type PrivacyState } from "./state";
import { loadSettings, loadState, saveState } from "./storage";

/** Match patterns for a granted site (https everywhere; http only for local test hosts). */
export function sitePatterns(site: string): string[] {
  const local = site === "localhost" || /^\d+\.\d+\.\d+\.\d+$/.test(site);
  return local ? [`http://${site}/*`] : [`https://${site}/*`, `https://*.${site}/*`];
}

/** Sites the user added AND still holds a host permission for. */
export async function grantedSites(sites: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const site of sites) {
    if (await chrome.permissions.contains({ origins: sitePatterns(site) })) out.push(site);
  }
  return out;
}

/**
 * Applies the privacy state to the real machinery (PRD §5.7 "OFF/PAUSED must gate the actual
 * content scripts, background jobs, alarms, network requests"):
 *  - inactive → unregister every dynamic content script, clear every alarm, tell open tabs to stop
 *  - active   → register the detector only on granted, non-private sites; digest alarm only if enabled
 */
export async function applyGate(): Promise<PrivacyState> {
  const now = Date.now();
  let state = await loadState();
  const ticked = reduce(state, { type: "tick" }, now);
  if (ticked !== state) {
    state = ticked;
    await saveState(state);
  }
  const active = isActive(state, now);
  const registered = await chrome.scripting.getRegisteredContentScripts();

  if (!active) {
    if (registered.length > 0) await chrome.scripting.unregisterContentScripts();
    await chrome.alarms.clearAll();
    await broadcastStop();
    await chrome.action.setBadgeText({ text: state.mode.kind === "off" ? "OFF" : "II" });
    await chrome.action.setBadgeBackgroundColor({ color: "#4a5875" });
    return state;
  }

  const settings = await loadSettings();
  const sites = (await grantedSites(settings.sites)).filter(
    (s) => !state.privateSites.includes(s) && !settings.mutedSites.includes(s),
  );
  const matches = sites.flatMap(sitePatterns);
  if (matches.length === 0) {
    if (registered.length > 0) await chrome.scripting.unregisterContentScripts();
  } else {
    const script = {
      id: CONTENT_SCRIPT_ID,
      js: ["content-scripts/detector.js"],
      matches,
      runAt: "document_idle" as const,
      persistAcrossSessions: true,
    };
    if (registered.some((r) => r.id === CONTENT_SCRIPT_ID))
      await chrome.scripting.updateContentScripts([script]);
    else await chrome.scripting.registerContentScripts([script]);
  }

  const notificationsGranted = await chrome.permissions.contains({
    permissions: ["notifications"],
  });
  if (settings.digest.enabled && notificationsGranted) {
    const existing = await chrome.alarms.get(DIGEST_ALARM);
    if (!existing)
      await chrome.alarms.create(DIGEST_ALARM, {
        when: nextDelivery(now, settings.digest.deliveryTime, settings.digest.timezone),
        periodInMinutes: 24 * 60,
      });
  } else {
    await chrome.alarms.clear(DIGEST_ALARM);
  }
  await chrome.action.setBadgeText({ text: "" });
  return state;
}

/** Tells already-injected content scripts to stop observing and remove any toast. */
async function broadcastStop(): Promise<void> {
  const tabs = await chrome.tabs.query({});
  await Promise.all(
    tabs.map((t) =>
      t.id === undefined
        ? undefined
        : chrome.tabs.sendMessage(t.id, { type: "stop" }).catch(() => undefined),
    ),
  );
}
