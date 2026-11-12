import "@suiem/ui/styles.css";
import "../../ui/page.css";
import { Button, ErrorState, LoadingState, Status as StatusPill, Wordmark } from "@suiem/ui";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { normalizeHost, PAUSE_PRESETS } from "../../core/state";
import { activeTab, dispatch, errorText, getStatus, type Status } from "../../ui/bridge";

function Popup() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<chrome.tabs.Tab | undefined>();
  const [custom, setCustom] = useState("90");

  useEffect(() => {
    void getStatus().then(setStatus, (e) => setError(errorText(e)));
    void activeTab().then(setTab);
  }, []);

  if (error) return <ErrorState message={error} />;
  if (!status) return <LoadingState />;
  const { state, description } = status;
  const isOn = state.mode.kind === "on" && !state.privateSession;
  const run = (p: Promise<Status>) => p.then(setStatus, (e) => setError(errorText(e)));
  const tabHost = tab?.url ? normalizeHost(tab.url) : null;
  const tabPrivate = tab?.id !== undefined && state.privateTabs.includes(tab.id);
  const sitePrivate = !!tabHost && state.privateSites.includes(tabHost);

  const tone =
    description.tone === "positive" ? "real" : description.tone === "warning" ? "test" : undefined;
  const short = state.privateSession
    ? "Private"
    : state.mode.kind === "on"
      ? "On"
      : state.mode.kind === "off"
        ? "Off"
        : "Paused";

  return (
    <main className="ext popup" aria-label="Suiem controls">
      <header className="pop-head">
        <Wordmark href="#" />
        <span className="s-badge" data-tone={tone}>
          {short}
        </span>
      </header>
      <div className="ext-body">
        <StatusPill tone={description.tone}>{description.label}</StatusPill>
        <Button
          variant={isOn ? "secondary" : "primary"}
          block
          className="s-btn big-toggle"
          aria-pressed={isOn}
          data-testid="power"
          onClick={() => void run(dispatch(isOn ? { type: "turnOff" } : { type: "turnOn" }))}
        >
          {isOn ? "Turn off" : "Turn on"}
        </Button>

        <section className="ext-card">
          <span className="s-eyebrow">Pause detection</span>
          <div className="s-row" style={{ gap: 6 }}>
            {PAUSE_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="s-chip"
                onClick={() => void run(dispatch({ type: "pause", choice: p.choice }))}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="s-row" style={{ gap: 6 }}>
            <input
              className="s-input"
              style={{ width: 80, minHeight: 38 }}
              type="number"
              min={1}
              max={10080}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              aria-label="Pause minutes"
            />
            <span className="s-small s-muted">min</span>
            <Button
              size="sm"
              onClick={() =>
                void run(
                  dispatch({
                    type: "pause",
                    choice: { kind: "minutes", minutes: Number(custom) || 30 },
                  }),
                )
              }
            >
              Pause
            </Button>
          </div>
        </section>

        <section className="ext-card">
          <span className="s-eyebrow">Private mode</span>
          <span className="s-small s-muted">
            Nothing from a private tab, site or session is detected or added to your digest.
          </span>
          <div className="s-row" style={{ gap: 6 }}>
            {tab?.id !== undefined ? (
              <button
                type="button"
                className="s-chip"
                aria-pressed={tabPrivate}
                onClick={() =>
                  void run(dispatch({ type: "privateTab", tabId: tab.id!, on: !tabPrivate }))
                }
              >
                {tabPrivate ? "✓ This tab is private" : "This tab"}
              </button>
            ) : null}
            {tabHost ? (
              <button
                type="button"
                className="s-chip"
                aria-pressed={sitePrivate}
                onClick={() =>
                  void run(dispatch({ type: "privateSite", host: tabHost, on: !sitePrivate }))
                }
              >
                {sitePrivate ? `✓ ${tabHost} is private` : `This site (${tabHost})`}
              </button>
            ) : null}
            <button
              type="button"
              className="s-chip"
              aria-pressed={state.privateSession}
              onClick={() =>
                void run(dispatch({ type: "privateSession", on: !state.privateSession }))
              }
            >
              {state.privateSession ? "✓ Private session (until restart)" : "Whole session"}
            </button>
          </div>
        </section>

        <Button
          variant="primary"
          block
          onClick={() =>
            tab?.windowId !== undefined && void chrome.sidePanel.open({ windowId: tab.windowId })
          }
        >
          Open research panel
        </Button>
      </div>
      <footer className="pop-foot">
        <span>
          {status.connected
            ? `Connected as @${status.connected.handle}`
            : "Not connected to a Suiem account"}
        </span>
        <span>
          <button
            type="button"
            className="linkish"
            onClick={() => void chrome.runtime.openOptionsPage()}
          >
            Options
          </button>
          {" · "}
          <a href={status.webOrigin} target="_blank" rel="noreferrer">
            Open Suiem ↗
          </a>
        </span>
        <span className="s-faint">Sites: {status.grantedSites.join(", ") || "none granted"}</span>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
