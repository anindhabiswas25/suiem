import type { orderPreviewResponse } from "@suiem/shared/schemas";
import { Alert, Button, NetworkBadge, Status } from "@suiem/ui";
import type { z } from "zod";

export type Preview = z.infer<typeof orderPreviewResponse>;

/** Seconds left on the quote (never negative). Pure, so it can be tested. */
export const secondsLeft = (expiresAt: string, now: number) =>
  Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));

export interface DecodedCall {
  functionName: string;
  trader: string;
  token: string;
  amountIn: string;
  price: string;
  minOut: string;
  expiry: string;
}

/**
 * Order preview: every field from the API, a live expiry countdown, a re-quote button once
 * expired, and a confirmation checkbox that must be ticked before the confirm button works.
 * Presentational only (no network): tested with react-dom/server.
 */
export function TicketView({
  preview,
  now,
  acknowledged,
  decoded,
  busy,
  onAcknowledge,
  onRequote,
  onConfirm,
}: {
  preview: Preview;
  now: number;
  acknowledged: boolean;
  decoded: DecodedCall | null;
  busy: boolean;
  onAcknowledge: (v: boolean) => void;
  onRequote: () => void;
  onConfirm: () => void;
}) {
  const left = secondsLeft(preview.expiresAt, now);
  const expired = left === 0;
  const testnet = preview.book === "testnet";
  const ackText = testnet
    ? "I understand this is a testnet token with no value and not a security."
    : "I understand this is a simulated paper trade: nothing is bought and no money moves.";
  return (
    <div className="s-stack" data-testid="order-preview">
      <div className="s-row">
        <NetworkBadge network={testnet ? "testnet" : "offchain"} />
        <span className="s-badge" data-tone="neutral">
          {preview.bookLabel}
        </span>
        <Status tone={expired ? "negative" : left <= 10 ? "warning" : "positive"}>
          <span data-testid="countdown">
            {expired ? "Quote expired" : `Quote valid for ${left}s`}
          </span>
        </Status>
      </div>
      <table className="figures">
        <tbody>
          <Row
            k="Instrument"
            v={`${preview.instrument.displayName} (${preview.instrument.symbol})`}
          />
          <Row k="What it is" v={preview.instrument.legalTypeLabel} />
          <Row
            k="Network"
            v={testnet ? "Robinhood Chain testnet (46630)" : "Offchain (simulated)"}
          />
          <Row
            k={preview.side === "buy" ? "You pay" : "You sell"}
            v={`${preview.amountIn.value} ${preview.amountIn.asset}`}
          />
          <Row
            k="Estimated to receive"
            v={`${preview.estimatedOut.value} ${preview.estimatedOut.asset}`}
          />
          <Row
            k="Minimum to receive (slippage bound)"
            v={`${preview.minOut.value} ${preview.minOut.asset} (${preview.slippageBps / 100}% max slippage)`}
          />
          <Row
            k="Fee"
            v={`${preview.fee.value} ${preview.fee.asset} (${preview.fee.bps / 100}%)`}
          />
          <Row
            k="Price"
            v={`USD ${preview.price.value} at ${new Date(preview.price.at).toLocaleTimeString()} · ${preview.price.source}${preview.price.executionPrice !== preview.price.value ? ` · execution USD ${preview.price.executionPrice}` : ""}`}
          />
          <Row k="Route" v={preview.route.description} link={preview.route.explorerUrl} />
          {preview.approval ? (
            <Row
              k="Approval"
              v={
                preview.approval.needed
                  ? `Exact-amount approval of ${preview.approval.amount} dUSD to the venue (never unlimited)`
                  : "Already approved for this exact amount"
              }
            />
          ) : null}
          {testnet ? (
            <Row
              k="Simulation"
              v={
                preview.simulation.ran
                  ? preview.simulation.ok
                    ? "eth_call succeeded"
                    : preview.simulation.detail
                  : preview.simulation.detail
              }
            />
          ) : null}
        </tbody>
      </table>
      {decoded ? (
        <details data-testid="decoded-call">
          <summary>Exactly what your wallet will sign (decoded, matches the preview)</summary>
          <pre className="s-mono s-small">{JSON.stringify(decoded, null, 2)}</pre>
        </details>
      ) : null}
      <ul className="s-small" style={{ margin: 0, paddingLeft: 18 }}>
        {preview.checks.map((c) => (
          <li key={c.name}>
            {c.ok ? "✓" : "✕"} {c.name}: {c.detail}
          </li>
        ))}
      </ul>
      <Alert>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {preview.risks.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </Alert>
      <label className="s-check">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => onAcknowledge(e.target.checked)}
          data-testid="acknowledge"
        />
        <span>{ackText}</span>
      </label>
      <div className="s-row">
        {expired ? (
          <Button variant="primary" onClick={onRequote} data-testid="requote">
            Get a new quote
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!acknowledged || busy}
            loading={busy}
            onClick={onConfirm}
            data-testid="confirm-order"
          >
            {testnet ? "Confirm and sign in wallet" : "Place paper trade"}
          </Button>
        )}
        {!expired ? (
          <Button variant="ghost" onClick={onRequote}>
            Re-quote
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function Row({ k, v, link }: { k: string; v: string; link?: string | null }) {
  return (
    <tr>
      <th style={{ width: "34%" }}>{k}</th>
      <td>
        {v}{" "}
        {link ? (
          <a href={link} target="_blank" rel="noreferrer noopener">
            explorer
          </a>
        ) : null}
      </td>
    </tr>
  );
}
