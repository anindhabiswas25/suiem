import "@suiem/ui/styles.css";
import "../../ui/page.css";
import { detect, ENTITY_DICTIONARY, entityById } from "@suiem/shared/entities";
import {
  Alert,
  Button,
  Card,
  EmptyState,
  ErrorState,
  LoadingState,
  NetworkBadge,
  Status as StatusPill,
  Wordmark,
} from "@suiem/ui";
import { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { apiRequest } from "../../core/net";
import { isActive, normalizeHost } from "../../core/state";
import type { PanelContext } from "../../core/storage";
import { activeTab, errorText, getStatus, record, type Status } from "../../ui/bridge";

interface Instrument {
  id: string;
  symbol: string;
  displayName: string;
  network: "mainnet" | "testnet" | "offchain";
  status: string;
  label: string;
}

/** The tab this panel belongs to (E2E tests open the panel as a page with ?tab=<id>). */
async function panelKey(): Promise<number | "window"> {
  const param = new URLSearchParams(location.search).get("tab");
  if (param) return Number(param);
  return (await activeTab())?.id ?? "window";
}

function resolveEntity(ctx: PanelContext | null): string | null {
  if (ctx?.entityId && entityById(ctx.entityId)) return ctx.entityId;
  if (ctx?.selection) {
    const [best] = detect(ctx.selection, { domain: "selection" }).filter(
      (d) => d.confidence >= 0.5,
    );
    if (best) return best.entityId;
  }
  return null;
}

function Panel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [ctx, setCtx] = useState<PanelContext | null>(null);
  const [entityId, setEntityId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [instruments, setInstruments] = useState<Instrument[] | null>(null);
  const [instrumentsError, setInstrumentsError] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [includeExcerpt, setIncludeExcerpt] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{
    tone: "positive" | "negative";
    text: string;
    link?: string;
  } | null>(null);

  useEffect(() => {
    let key: number | "window" = "window";
    const load = async () => {
      key = await panelKey();
      const all = await chrome.storage.session.get(`panel:${key}`);
      const c = (all[`panel:${key}`] as PanelContext | undefined) ?? null;
      setCtx(c);
      setEntityId(resolveEntity(c));
      setStatus(await getStatus());
    };
    void load();
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "session" && changes[`panel:${key}`]) void load();
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const active = status ? isActive(status.state, Date.now()) : false;
  const entity = entityId ? entityById(entityId) : undefined;
  const sourceDomain = ctx?.sourceUrl ? normalizeHost(ctx.sourceUrl) : null;

  useEffect(() => {
    setInstruments(null);
    setInstrumentsError(null);
    setPreview(false);
    setResult(null);
    if (!entityId || !active || !status?.connected) return;
    void apiRequest<{ items: Instrument[] }>(
      "GET",
      `/entities/${encodeURIComponent(entityId)}/instruments`,
    ).then(
      (r) => setInstruments(r.items),
      (e) => setInstrumentsError(errorText(e)),
    );
  }, [entityId, active, status?.connected]);

  const payload = useMemo(() => {
    if (!entityId || !ctx?.sourceUrl) return null;
    return {
      entityId,
      sourceUrl: ctx.sourceUrl,
      ...(includeExcerpt && ctx.selection ? { selectedExcerpt: ctx.selection.slice(0, 2000) } : {}),
      userConfirmed: true as const,
    };
  }, [entityId, ctx, includeExcerpt]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return ENTITY_DICTIONARY.filter(
      (e) =>
        e.name.toLowerCase().includes(q) || e.tickers.some((t) => t.toLowerCase().startsWith(q)),
    ).slice(0, 8);
  }, [query]);

  if (!status) return <LoadingState />;

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setResult(null);
    try {
      await fn();
    } catch (e) {
      setResult({ tone: "negative", text: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="ext" aria-label="Suiem research panel">
      <Wordmark href="#" />
      {!active ? (
        <Alert>
          Suiem is {status.state.mode.kind === "off" ? "off" : "paused or private"}. Nothing will be
          sent until you turn it back on.
        </Alert>
      ) : null}
      {!status.connected ? (
        <Alert>
          Connect the extension to your Suiem account to request research or use your watchlist.{" "}
          <a href="#" onClick={() => void chrome.runtime.openOptionsPage()}>
            Open options
          </a>
        </Alert>
      ) : null}

      {!entity ? (
        <Card title="Which company?">
          <input
            className="s-input"
            placeholder="Search name or ticker"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search companies"
          />
          <ul className="muted-list">
            {matches.map((e) => (
              <li key={e.canonicalId}>
                <span>
                  {e.name} <span className="s-muted">{e.tickers.join(" · ")}</span>
                </span>
                <Button onClick={() => setEntityId(e.canonicalId)}>Select</Button>
              </li>
            ))}
          </ul>
          {query && matches.length === 0 ? (
            <EmptyState title="No match">Try a ticker like NVDA.</EmptyState>
          ) : null}
        </Card>
      ) : (
        <>
          <Card title={entity.name}>
            <span className="s-muted" data-testid="entity-card">
              {entity.legalName} · {entity.kind} · {entity.sector} · {entity.tickers.join(" · ")}
            </span>
            <span className="s-small">
              <strong>Why you're seeing this:</strong> {ctx?.why ?? "You opened the research panel"}
              . Detection ran on your device.
            </span>
          </Card>

          <Card title="Instruments">
            {!status.connected || !active ? (
              <span className="s-muted">Connect and turn Suiem on to load instruments.</span>
            ) : null}
            {instrumentsError ? <ErrorState message={instrumentsError} /> : null}
            {instruments === null && status.connected && active && !instrumentsError ? (
              <LoadingState />
            ) : null}
            {instruments?.length === 0 ? (
              <span className="s-muted">No registry instruments for this company.</span>
            ) : null}
            <ul className="muted-list">
              {instruments?.map((i) => (
                <li key={i.id}>
                  <span>
                    {i.symbol} <span className="s-small s-muted">{i.label}</span>
                  </span>
                  <NetworkBadge network={i.network} />
                </li>
              ))}
            </ul>
            <span className="s-small s-muted">
              Suiem never buys from the extension. Testnet tokens have no value and are not
              securities.
            </span>
          </Card>

          <Card title="AI research">
            {!preview ? (
              <Button
                variant="primary"
                disabled={!active || !status.connected || !payload}
                onClick={() => setPreview(true)}
                data-testid="request-research"
              >
                Request AI research
              </Button>
            ) : (
              <>
                <span>This is exactly what will be sent to Suiem:</span>
                <pre className="preview" data-testid="research-preview">
                  {JSON.stringify(payload, null, 2)}
                </pre>
                {ctx?.selection ? (
                  <label className="s-check">
                    <input
                      type="checkbox"
                      checked={includeExcerpt}
                      onChange={(e) => setIncludeExcerpt(e.target.checked)}
                      data-testid="include-excerpt"
                    />
                    <span>Include my selected text ({ctx.selection.length} characters)</span>
                  </label>
                ) : null}
                <div className="s-row">
                  <Button
                    variant="primary"
                    loading={busy === "research"}
                    data-testid="confirm-research"
                    onClick={() =>
                      void run("research", async () => {
                        const r = await apiRequest<{ researchUrl: string }>(
                          "POST",
                          "/extension/research-context",
                          payload,
                        );
                        await record("research_requested", entity.canonicalId, sourceDomain);
                        setPreview(false);
                        setResult({
                          tone: "positive",
                          text: "Queued. Your brief will appear in Suiem Research.",
                          link: r.researchUrl,
                        });
                      })
                    }
                  >
                    Confirm and send
                  </Button>
                  <Button onClick={() => setPreview(false)}>Cancel</Button>
                </div>
              </>
            )}
            {!payload ? (
              <span className="s-small s-muted">
                Open the panel from a page to attach its address as the source.
              </span>
            ) : null}
          </Card>

          <div className="s-row">
            <Button
              loading={busy === "watch"}
              disabled={!active || !status.connected}
              data-testid="add-watchlist"
              onClick={() =>
                void run("watch", async () => {
                  const r = await apiRequest<{ created: boolean }>(
                    "POST",
                    "/watchlists/default/items",
                    { entityId: entity.canonicalId },
                  );
                  await record("watchlist_added", entity.canonicalId, sourceDomain);
                  setResult({
                    tone: "positive",
                    text: r.created ? "Added to your watchlist." : "Already on your watchlist.",
                  });
                })
              }
            >
              Add to watchlist
            </Button>
            <a
              className="s-btn"
              href={`${status.webOrigin}/research/${encodeURIComponent(entity.canonicalId)}`}
              target="_blank"
              rel="noreferrer"
            >
              Open in Suiem
            </a>
            <Button variant="ghost" onClick={() => setEntityId(null)}>
              Other company
            </Button>
          </div>
        </>
      )}
      {result ? (
        <StatusPill tone={result.tone}>
          <span data-testid="panel-result">{result.text}</span>{" "}
          {result.link ? (
            <a href={result.link} target="_blank" rel="noreferrer">
              Open
            </a>
          ) : null}
        </StatusPill>
      ) : null}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Panel />);
