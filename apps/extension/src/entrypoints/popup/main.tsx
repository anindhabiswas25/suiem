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

  return (
    <main className="ext" aria-label="Suiem controls">
      <Wordmark href="#" />
      <StatusPill tone={description.tone}>{description.label}</StatusPill>
      <Button
        variant="primary"
        className="s-btn big-toggle"
        aria-pressed={isOn}
        data-testid="power"
        onClick={() => void run(dispatch(isOn ? { type: "turnOff" } : { type: "turnOn" }))}
      >
        {isOn ? "● ON · turn off" : "○ OFF · turn on"}
      </Button>

      <fieldset className="s-stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>Pause detection</legend>
        <div className="s-row">
          {PAUSE_PRESETS.map((p) => (
            <Button
              key={p.label}
              onClick={() => void run(dispatch({ type: "pause", choice: p.choice }))}
            >
              {p.label}
            </Button>
          ))}
        </div>
        <div className="s-row">
          <label className="s-row" style={{ gap: 6 }}>
            <span>Custom</span>
            <input
              className="s-input"
              style={{ width: 80 }}
              type="number"
              min={1}
              max={10080}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              aria-label="Pause minutes"
            />
            <span>min</span>
          </label>
          <Button
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
      </fieldset>

      <fieldset className="s-stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
        <legend style={{ fontWeight: 600, marginBottom: 6 }}>Private mode</legend>
        <span className="s-small s-muted">
          Nothing from a private tab, site or session is detected or added to your digest.
        </span>
        <div className="s-row">
          {tab?.id !== undefined ? (
            <Button
              aria-pressed={tabPrivate}
              onClick={() =>
                void run(dispatch({ type: "privateTab", tabId: tab.id!, on: !tabPrivate }))
              }
            >
              {tabPrivate ? "✓ This tab is private" : "This tab"}
            </Button>
          ) : null}
          {tabHost ? (
            <Button
              aria-pressed={sitePrivate}
              onClick={() =>
                void run(dispatch({ type: "privateSite", host: tabHost, on: !sitePrivate }))
              }
            >
              {sitePrivate ? `✓ ${tabHost} is private` : `This site (${tabHost})`}
            </Button>
          ) : null}
          <Button
            aria-pressed={state.privateSession}
            onClick={() =>
              void run(dispatch({ type: "privateSession", on: !state.privateSession }))
            }
          >
            {state.privateSession ? "✓ Private session (until restart)" : "Whole session"}
          </Button>
        </div>
      </fieldset>

      <div className="s-row">
        <Button onClick={() => void chrome.runtime.openOptionsPage()}>Options</Button>
        <Button
          onClick={() =>
            tab?.windowId !== undefined && void chrome.sidePanel.open({ windowId: tab.windowId })
          }
        >
          Research panel
        </Button>
      </div>
      <span className="footer-note">
        {status.connected
          ? `Connected as @${status.connected.handle}`
          : "Not connected to a Suiem account"}{" "}
        · Sites: {status.grantedSites.join(", ") || "none granted"}
      </span>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Popup />);
