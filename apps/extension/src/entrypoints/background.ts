import { detectionSchema } from "@suiem/shared/extension";
import { entityById } from "@suiem/shared/entities";
import { DIGEST_ALARM, WEB_ORIGIN } from "../core/config";
import { addItem, type DigestKind, makeItem, purge } from "../core/digest";
import { applyGate, grantedSites } from "../core/gate";
import { ApiCallError, apiRequest } from "../core/net";
import { prune, shouldNotify } from "../core/ratelimit";
import {
  allowsContext,
  describe,
  hostMatches,
  isActive,
  normalizeHost,
  reduce,
  type StateEvent,
} from "../core/state";
import {
  clearLocalActivity,
  loadAuth,
  loadDigest,
  loadHistory,
  loadSaved,
  loadSettings,
  loadState,
  saveAuth,
  saveDigest,
  saveHistory,
  savePanelContext,
  saveSaved,
  saveSettings,
  saveState,
  type Settings,
} from "../core/storage";

const MENU_ID = "suiem-research-selection";

/** Content-script page URL → `origin + path` (no query, no hash: those can carry personal data). */
function cleanUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url);
    return /^https?:$/.test(u.protocol) ? `${u.origin}${u.pathname}` : undefined;
  } catch {
    return undefined;
  }
}
const hostOf = (url: string | undefined) => (url ? normalizeHost(url) : null);

async function record(kind: DigestKind, entityId: string, domain: string | null) {
  const entity = entityById(entityId);
  if (!entity) return;
  const settings = await loadSettings();
  const items = purge(
    addItem(
      await loadDigest(),
      makeItem(kind, { id: entityId, name: entity.name }, domain, Date.now(), crypto.randomUUID()),
    ),
    Date.now(),
    settings.digest.retentionDays,
  );
  await saveDigest(items);
}

async function syncMenus(active: boolean) {
  await chrome.contextMenus.removeAll();
  if (active)
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Research selected company with Suiem",
      contexts: ["selection"],
    });
}

async function refresh() {
  const state = await applyGate();
  await syncMenus(isActive(state, Date.now()));
  return state;
}

async function status() {
  const state = await loadState();
  const settings = await loadSettings();
  const auth = await loadAuth();
  return {
    state,
    description: describe(state, Date.now()),
    settings,
    grantedSites: await grantedSites(settings.sites),
    connected: auth ? { handle: auth.handle, installationId: auth.installationId } : null,
    webOrigin: WEB_ORIGIN,
  };
}

/** Pairing awaiting the user's confirmation of the account handle (security review). */
interface PendingPair {
  token: string;
  installationId: string;
  handle: string;
}

type PageMessage =
  | { type: "status" }
  | { type: "event"; event: StateEvent }
  | { type: "settings"; patch: Partial<Settings> }
  | { type: "pair-start"; code: string }
  | { type: "pair-confirm" }
  | { type: "pair-cancel" }
  | { type: "disconnect" }
  | { type: "record"; kind: DigestKind; entityId: string; domain: string | null }
  | { type: "digest-delete"; id: string }
  | { type: "activity-clear"; alsoServer: boolean };

async function handlePage(msg: PageMessage): Promise<unknown> {
  switch (msg.type) {
    case "status":
      return status();
    case "event": {
      const next = reduce(await loadState(), msg.event, Date.now());
      await saveState(next);
      await refresh();
      return status();
    }
    case "settings": {
      const current = await loadSettings();
      const next: Settings = {
        ...current,
        ...msg.patch,
        digest: { ...current.digest, ...(msg.patch.digest ?? {}) },
      };
      next.sites = [
        ...new Set(next.sites.map((s) => normalizeHost(s)).filter((s): s is string => !!s)),
      ].sort();
      next.notifyThreshold = Math.min(0.99, Math.max(0.5, next.notifyThreshold));
      next.digest.retentionDays = Math.min(365, Math.max(1, Math.round(next.digest.retentionDays)));
      await saveSettings(next);
      await refresh();
      return status();
    }
    case "pair-start": {
      const r = await apiRequest<PendingPair>(
        "POST",
        "/extension/installations",
        { pairingCode: msg.code.trim().toUpperCase(), label: "Chrome extension" },
        { anonymous: true },
      );
      await chrome.storage.session.set({ pendingPair: r });
      return { handle: r.handle };
    }
    case "pair-confirm": {
      const { pendingPair } = (await chrome.storage.session.get("pendingPair")) as {
        pendingPair?: PendingPair;
      };
      if (!pendingPair) throw new Error("No pairing in progress");
      await saveAuth(pendingPair);
      await chrome.storage.session.remove("pendingPair");
      return status();
    }
    case "pair-cancel": {
      const { pendingPair } = (await chrome.storage.session.get("pendingPair")) as {
        pendingPair?: PendingPair;
      };
      await chrome.storage.session.remove("pendingPair");
      if (pendingPair)
        await apiRequest(
          "DELETE",
          `/extension/installations/${pendingPair.installationId}`,
          undefined,
          { token: pendingPair.token },
        ).catch(() => undefined);
      return status();
    }
    case "disconnect": {
      const auth = await loadAuth();
      if (auth)
        await apiRequest("DELETE", `/extension/installations/${auth.installationId}`).catch(
          () => undefined,
        );
      await saveAuth(null);
      return status();
    }
    case "record":
      await record(msg.kind, msg.entityId, msg.domain);
      return { ok: true };
    case "digest-delete":
      await saveDigest((await loadDigest()).filter((i) => i.id !== msg.id));
      return { ok: true };
    case "activity-clear": {
      await clearLocalActivity();
      let deletedOnServer = 0;
      if (msg.alsoServer)
        deletedOnServer = (await apiRequest<{ deleted: number }>("DELETE", "/extension/activity"))
          .deleted;
      return { ok: true, deletedOnServer };
    }
  }
}

type ContentMessage =
  | { type: "cs-hello" }
  | { type: "detection"; detection: unknown }
  | { type: "toast"; action: "research" | "save" | "mute-entity" | "mute-site"; entityId: string };

async function handleContent(
  msg: ContentMessage,
  sender: chrome.runtime.MessageSender,
): Promise<unknown> {
  const tabId = sender.tab?.id;
  const host = hostOf(sender.url);
  const state = await loadState();
  const now = Date.now();
  const settings = await loadSettings();
  const allowed =
    tabId !== undefined &&
    host !== null &&
    allowsContext(state, now, { tabId, host }) &&
    settings.sites.some((s) => hostMatches(host, s)) &&
    !settings.mutedSites.some((s) => hostMatches(host, s));

  if (msg.type === "cs-hello") return { active: allowed, threshold: settings.notifyThreshold };
  if (!allowed) return { notify: false, reason: "inactive" };

  if (msg.type === "detection") {
    const d = detectionSchema.safeParse(msg.detection);
    if (!d.success) return { notify: false, reason: "invalid" };
    const det = d.data;
    if (det.confidence < settings.notifyThreshold || settings.mutedEntities.includes(det.entityId))
      return { notify: false, reason: "filtered" };
    const history = await loadHistory();
    if (!shouldNotify(history, { entityId: det.entityId, domain: host }, now, settings.rateLimits))
      return { notify: false, reason: "rate_limited" };
    await saveHistory(
      prune(
        [...history, { entityId: det.entityId, domain: host, at: now }],
        now,
        settings.rateLimits,
      ),
    );
    const entity = entityById(det.entityId);
    if (!entity) return { notify: false, reason: "unknown" };
    const kind = entity.kind === "company" ? "" : ` (${entity.kind})`;
    return {
      notify: true,
      entityId: entity.canonicalId,
      name: `${entity.name}${kind}`,
      tickers: entity.tickers,
      why: `Mentioned on this page (${Math.round(det.confidence * 100)}% match). Detected on your device; nothing was sent.`,
    };
  }

  // Toast actions (each is an explicit click).
  const entity = entityById(msg.entityId);
  if (!entity) return { ok: false };
  if (msg.action === "research") {
    await savePanelContext(tabId!, {
      entityId: entity.canonicalId,
      sourceUrl: cleanUrl(sender.url),
      why: "You clicked Research on a detection notification",
      at: now,
    });
    await record("acknowledged", entity.canonicalId, host);
    await record("panel_opened", entity.canonicalId, host);
    return { ok: true };
  }
  if (msg.action === "save") {
    const saved = (await loadSaved()).filter((s) => s.entityId !== entity.canonicalId);
    await saveSaved(
      [...saved, { entityId: entity.canonicalId, name: entity.name, at: now }].slice(-100),
    );
    await record("saved_for_later", entity.canonicalId, host);
    return { ok: true };
  }
  if (msg.action === "mute-entity") {
    await saveSettings({
      ...settings,
      mutedEntities: [...new Set([...settings.mutedEntities, entity.canonicalId])],
    });
    return { ok: true };
  }
  await saveSettings({ ...settings, mutedSites: [...new Set([...settings.mutedSites, host])] });
  await refresh();
  return { ok: true };
}

function respond(p: Promise<unknown>, send: (r: unknown) => void) {
  p.then(send, (e: unknown) =>
    send({
      error:
        e instanceof ApiCallError
          ? `${e.message}`
          : e instanceof Error
            ? e.message
            : "Something went wrong",
      code: e instanceof ApiCallError ? e.code : undefined,
    }),
  );
  return true;
}

export default defineBackground(() => {
  chrome.runtime.onInstalled.addListener((details) => {
    void refresh();
    if (details.reason === "install") void chrome.runtime.openOptionsPage();
  });
  chrome.runtime.onStartup.addListener(() => {
    void (async () => {
      const s = await loadSettings();
      await saveDigest(purge(await loadDigest(), Date.now(), s.digest.retentionDays));
      await refresh();
    })();
  });

  // Pause expiry is checked on tab activity (no alarm runs while paused, so PAUSED = zero alarms).
  chrome.tabs.onActivated.addListener(() => void refresh());
  chrome.tabs.onUpdated.addListener((_id, info) => {
    if (info.status === "loading") void refresh();
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void (async () => {
      const s = await loadState();
      if (s.privateTabs.includes(tabId))
        await saveState(reduce(s, { type: "tabClosed", tabId }, Date.now()));
    })();
  });

  // Revoking a host permission (chrome://extensions or Options) stops detection immediately.
  chrome.permissions.onRemoved.addListener(() => void refresh());
  chrome.permissions.onAdded.addListener(() => void refresh());

  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== DIGEST_ALARM) return;
    void (async () => {
      const state = await refresh();
      if (!isActive(state, Date.now())) return;
      const s = await loadSettings();
      const items = purge(await loadDigest(), Date.now(), s.digest.retentionDays);
      await saveDigest(items);
      const recent = items.filter((i) => Date.now() - i.at < 86_400_000);
      if (
        recent.length > 0 &&
        (await chrome.permissions.contains({ permissions: ["notifications"] }))
      ) {
        chrome.notifications.create("suiem-digest", {
          type: "basic",
          iconUrl: chrome.runtime.getURL("icon/128.png"),
          title: "Your Suiem digest is ready",
          message: `${recent.length} research action(s) today. Local only, never uploaded.`,
        });
      }
    })();
  });
  chrome.notifications?.onClicked.addListener(() => void chrome.runtime.openOptionsPage());

  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId !== MENU_ID || tab?.id === undefined) return;
    // Opening the panel must happen synchronously inside the user gesture.
    void chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
    void (async () => {
      const state = await loadState();
      if (
        !allowsContext(state, Date.now(), {
          tabId: tab.id,
          host: hostOf(info.pageUrl) ?? undefined,
        })
      )
        return;
      // The selection stays on the device; it is only sent if the user ticks "include my selected text".
      await savePanelContext(tab.id!, {
        selection: (info.selectionText ?? "").slice(0, 2000),
        sourceUrl: cleanUrl(info.pageUrl),
        why: "You chose “Research selected company with Suiem”",
        at: Date.now(),
      });
    })();
  });

  chrome.runtime.onMessage.addListener((msg: { type?: string; action?: string }, sender, send) => {
    const fromContent =
      sender.tab !== undefined &&
      sender.url !== undefined &&
      !sender.url.startsWith(chrome.runtime.getURL(""));
    if (fromContent) {
      if (!["cs-hello", "detection", "toast"].includes(msg.type ?? "")) return false;
      // Side panel must open synchronously in the click's gesture, before any await.
      if (msg.type === "toast" && msg.action === "research" && sender.tab?.id !== undefined) {
        void chrome.sidePanel.open({ tabId: sender.tab.id }).catch(() => undefined);
      }
      return respond(handleContent(msg as ContentMessage, sender), send);
    }
    if (sender.id !== chrome.runtime.id) return false;
    return respond(handlePage(msg as PageMessage), send);
  });

  // One-click pairing from the Suiem web app (externally_connectable). The user still confirms.
  chrome.runtime.onMessageExternal.addListener(
    (msg: { type?: string; code?: string }, sender, send) => {
      if (sender.origin !== WEB_ORIGIN || msg.type !== "suiem.pair" || typeof msg.code !== "string")
        return false;
      void chrome.runtime.openOptionsPage();
      void chrome.storage.session.set({ incomingPairCode: msg.code.slice(0, 9) });
      send({ ok: true });
      return false;
    },
  );

  void refresh();
});
