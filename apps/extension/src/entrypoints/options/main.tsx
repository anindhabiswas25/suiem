import "@suiem/ui/styles.css";
import "../../ui/page.css";
import { entityById } from "@suiem/shared/entities";
import {
  Alert,
  Button,
  Card,
  DISCLAIMER,
  EmptyState,
  ErrorState,
  LoadingState,
  Status as StatusPill,
  Wordmark,
} from "@suiem/ui";
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { type DigestItem, group } from "../../core/digest";
import { sitePatterns } from "../../core/gate";
import { normalizeHost } from "../../core/state";
import { errorText, getStatus, send, type Status, updateSettings } from "../../ui/bridge";

type Msg = { tone: "positive" | "negative"; text: string } | null;

function Options() {
  const [status, setStatus] = useState<Status | null>(null);
  const [digest, setDigest] = useState<DigestItem[]>([]);
  const [msg, setMsg] = useState<Msg>(null);
  const [site, setSite] = useState("x.com");
  const [code, setCode] = useState("");
  const [pending, setPending] = useState<{ handle: string } | null>(null);
  const [alsoServer, setAlsoServer] = useState(false);

  const reload = useCallback(async () => {
    setStatus(await getStatus());
    const r = await chrome.storage.local.get("digest");
    setDigest((r.digest as DigestItem[] | undefined) ?? []);
  }, []);

  useEffect(() => {
    void reload().catch((e) => setMsg({ tone: "negative", text: errorText(e) }));
    void chrome.storage.session.get("incomingPairCode").then(async (r) => {
      if (typeof r.incomingPairCode === "string") {
        setCode(r.incomingPairCode);
        await chrome.storage.session.remove("incomingPairCode");
      }
    });
    const onChange = () => void reload();
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, [reload]);

  if (!status) return msg ? <ErrorState message={msg.text} /> : <LoadingState />;
  const s = status.settings;
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setMsg(null);
    try {
      await fn();
      await reload();
      setMsg({ tone: "positive", text: ok });
    } catch (e) {
      setMsg({ tone: "negative", text: errorText(e) });
    }
  };

  async function addSite() {
    const host = normalizeHost(site);
    if (!host) throw new Error("Enter a site like x.com");
    // Must run inside this click (user gesture): Chrome shows its own permission prompt.
    const granted = await chrome.permissions.request({ origins: sitePatterns(host) });
    if (!granted) throw new Error("Permission was not granted");
    await updateSettings({ sites: [...s.sites, host] });
  }
  async function removeSite(host: string) {
    await chrome.permissions.remove({ origins: sitePatterns(host) }).catch(() => false);
    await updateSettings({ sites: s.sites.filter((x) => x !== host) });
  }
  async function toggleDigest(enabled: boolean) {
    if (enabled && !(await chrome.permissions.request({ permissions: ["notifications"] })))
      throw new Error("Notifications permission is needed for the digest reminder");
    await updateSettings({
      digest: {
        ...s.digest,
        enabled,
        timezone:
          s.digest.timezone === "UTC"
            ? Intl.DateTimeFormat().resolvedOptions().timeZone
            : s.digest.timezone,
      },
    });
  }

  return (
    <main className="ext" style={{ maxWidth: 760, margin: "0 auto" }}>
      <Wordmark href="#" />
      <h1>Suiem Intelligence settings</h1>
      <StatusPill tone={status.description.tone}>
        <span aria-hidden="true">{status.description.icon}</span> {status.description.label}
      </StatusPill>
      {msg ? (
        <StatusPill tone={msg.tone === "positive" ? "positive" : "negative"}>{msg.text}</StatusPill>
      ) : null}

      <Card title="Account">
        {status.connected ? (
          <>
            <StatusPill tone="positive">Connected as @{status.connected.handle}</StatusPill>
            <div>
              <Button
                variant="danger"
                onClick={() =>
                  void act(
                    () => send({ type: "disconnect" }),
                    "Disconnected. The device token was revoked.",
                  )
                }
              >
                Disconnect
              </Button>
            </div>
          </>
        ) : pending ? (
          <>
            <Alert>
              This code belongs to <strong>@{pending.handle}</strong>. Only connect if this is{" "}
              <em>your</em> Suiem account. Anything you research or add to a watchlist from this
              extension will go to this account.
            </Alert>
            <div className="s-row">
              <Button
                variant="primary"
                data-testid="pair-confirm"
                onClick={() =>
                  void act(async () => {
                    await send({ type: "pair-confirm" });
                    setPending(null);
                  }, `Connected as @${pending.handle}`)
                }
              >
                Yes, connect @{pending.handle}
              </Button>
              <Button
                onClick={() =>
                  void act(async () => {
                    await send({ type: "pair-cancel" });
                    setPending(null);
                  }, "Cancelled. Nothing was connected.")
                }
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <span className="s-muted">
              In Suiem, open <strong>Settings → Browser extension → Connect</strong> and paste the
              one-time code here (valid 5 minutes, single use).
            </span>
            <div className="s-row">
              <input
                className="s-input"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="ABCD-EFGH"
                aria-label="Pairing code"
                data-testid="pair-code"
              />
              <Button
                variant="primary"
                data-testid="pair-start"
                onClick={() =>
                  void act(
                    async () =>
                      setPending(await send<{ handle: string }>({ type: "pair-start", code })),
                    "Check the account below, then confirm.",
                  )
                }
              >
                Connect
              </Button>
            </div>
          </>
        )}
      </Card>

      <Card title="Sites where Suiem may detect companies">
        <span className="s-muted">
          Suiem only runs on sites you add here. Each one asks Chrome for permission; removing it
          revokes the permission immediately.
        </span>
        <ul className="muted-list" aria-label="Granted sites">
          {s.sites.length === 0 ? <li className="s-muted">No sites yet.</li> : null}
          {s.sites.map((host) => (
            <li key={host}>
              <span>
                {host}{" "}
                {status.grantedSites.includes(host) ? (
                  ""
                ) : (
                  <em className="s-muted">(permission missing)</em>
                )}
              </span>
              <Button onClick={() => void act(() => removeSite(host), `Removed ${host}`)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
        <div className="s-row">
          <input
            className="s-input"
            value={site}
            onChange={(e) => setSite(e.target.value)}
            aria-label="Site to add"
          />
          <Button onClick={() => void act(addSite, "Site added")}>Add site</Button>
        </div>
      </Card>

      <Card title="Muted">
        <ul className="muted-list">
          {s.mutedEntities.map((id) => (
            <li key={id}>
              <span>{entityById(id)?.name ?? id}</span>
              <Button
                onClick={() =>
                  void act(
                    () =>
                      updateSettings({ mutedEntities: s.mutedEntities.filter((x) => x !== id) }),
                    "Unmuted",
                  )
                }
              >
                Unmute
              </Button>
            </li>
          ))}
          {s.mutedSites.map((h) => (
            <li key={h}>
              <span>Site: {h}</span>
              <Button
                onClick={() =>
                  void act(
                    () => updateSettings({ mutedSites: s.mutedSites.filter((x) => x !== h) }),
                    "Unmuted",
                  )
                }
              >
                Unmute
              </Button>
            </li>
          ))}
          {s.mutedEntities.length + s.mutedSites.length === 0 ? (
            <li className="s-muted">Nothing muted.</li>
          ) : null}
        </ul>
      </Card>

      <Card title="Notifications">
        <label className="s-field">
          <span>
            Notify only when the match is at least {Math.round(s.notifyThreshold * 100)}% confident
          </span>
          <input
            type="range"
            min={50}
            max={99}
            value={Math.round(s.notifyThreshold * 100)}
            onChange={(e) =>
              void act(
                () => updateSettings({ notifyThreshold: Number(e.target.value) / 100 }),
                "Saved",
              )
            }
          />
        </label>
        <span className="s-small s-muted">
          At most once per company every {s.rateLimits.perEntityMinutes} minutes and{" "}
          {s.rateLimits.perDomainPerHour} per site per hour.
        </span>
      </Card>

      <Card title="Daily digest (local only)">
        <label className="s-check">
          <input
            type="checkbox"
            checked={s.digest.enabled}
            onChange={(e) => void act(() => toggleDigest(e.target.checked), "Saved")}
          />
          <span>
            Remind me with a daily digest of my own research actions. Stored only on this device;
            never uploaded.
          </span>
        </label>
        <div className="s-row">
          <label className="s-field">
            <span>Delivery time</span>
            <input
              className="s-input"
              type="time"
              value={s.digest.deliveryTime}
              onChange={(e) =>
                void act(
                  () => updateSettings({ digest: { ...s.digest, deliveryTime: e.target.value } }),
                  "Saved",
                )
              }
            />
          </label>
          <label className="s-field">
            <span>Timezone</span>
            <input
              className="s-input"
              value={s.digest.timezone}
              onChange={(e) =>
                void act(
                  () => updateSettings({ digest: { ...s.digest, timezone: e.target.value } }),
                  "Saved",
                )
              }
            />
          </label>
          <label className="s-field">
            <span>Keep for (days)</span>
            <input
              className="s-input"
              type="number"
              min={1}
              max={365}
              value={s.digest.retentionDays}
              onChange={(e) =>
                void act(
                  () =>
                    updateSettings({
                      digest: { ...s.digest, retentionDays: Number(e.target.value) },
                    }),
                  "Saved",
                )
              }
            />
          </label>
        </div>
        <section aria-label="Digest" data-testid="digest">
          {digest.length === 0 ? (
            <EmptyState title="Your digest is empty">
              It only lists things you chose to do: research you opened or requested, companies you
              saved or added to your watchlist.
            </EmptyState>
          ) : (
            group(digest).map((g) => (
              <div key={g.kind} className="s-stack" style={{ gap: 4, marginBottom: 12 }}>
                <strong>{g.title}</strong>
                <ul className="muted-list">
                  {g.items.map((i) => (
                    <li key={i.id} data-testid="digest-item" data-kind={i.kind}>
                      <span>
                        {i.entityName}{" "}
                        <span className="s-small s-muted">
                          · {i.why}
                          {i.domain ? ` · ${i.domain}` : ""} · {new Date(i.at).toLocaleString()}
                        </span>
                      </span>
                      <Button
                        onClick={() =>
                          void act(() => send({ type: "digest-delete", id: i.id }), "Deleted")
                        }
                      >
                        Delete
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </section>
      </Card>

      <Card title="Your data">
        <label className="s-check">
          <input
            type="checkbox"
            checked={alsoServer}
            onChange={(e) => setAlsoServer(e.target.checked)}
          />
          <span>Also delete my research requests stored in my Suiem account</span>
        </label>
        <div>
          <Button
            variant="danger"
            data-testid="delete-all"
            onClick={() =>
              void act(
                () => send({ type: "activity-clear", alsoServer }),
                "All local activity deleted",
              )
            }
          >
            Delete all local activity
          </Button>
        </div>
      </Card>

      <p className="footer-note">
        {DISCLAIMER} Suiem never buys anything, never uploads your browsing history, and sends
        nothing without your action. <a href={`${status.webOrigin}/help`}>Help &amp; disclosures</a>
      </p>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Options />);
