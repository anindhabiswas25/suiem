"use client";
import type { siweNonceResponse } from "@suiem/shared/schemas";
import { Alert, Button, NetworkBadge, Status } from "@suiem/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { z } from "zod";
import { api, ApiRequestError } from "../lib/api";
import { buildSiweMessage, useWalletSigner } from "./auth";

type Nonce = z.infer<typeof siweNonceResponse>;

/** Custody model and risks, shown before any wallet is linked (PRD §5.1 step 6). */
export function CustodyExplanation() {
  return (
    <Alert>
      <strong>How wallets work on Suiem</strong>
      <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
        <li>
          <strong>You keep custody.</strong> Your wallet app holds your keys. Suiem never sees your
          private key or seed phrase and cannot move your funds.
        </li>
        <li>
          <strong>Linking is a free signature, not a transaction.</strong> It only proves you
          control the address.
        </li>
        <li>
          <strong>Recovery is your wallet's job.</strong> If you lose your wallet's recovery phrase,
          Suiem cannot restore it.
        </li>
        <li>
          Every onchain action is shown with its network. <NetworkBadge network="mainnet" /> uses
          real $WIF and is irreversible. <NetworkBadge network="testnet" /> tokens have no value and
          are not securities.
        </li>
        <li>Your linked address stays private unless you choose to show it on your profile.</li>
      </ul>
    </Alert>
  );
}

export function WalletLink({ onLinked }: { onLinked?: () => void }) {
  const [ack, setAck] = useState(false);
  const [chainId, setChainId] = useState<4663 | 46630>(4663);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: "positive" | "negative"; text: string } | null>(
    null,
  );
  const wallet = useWalletSigner();
  const qc = useQueryClient();

  async function link() {
    setBusy(true);
    setResult(null);
    try {
      const address = await wallet.ensure(chainId);
      const nonce = await api<Nonce>("POST", "/wallet/nonce", { chainId });
      const msg = buildSiweMessage(address, nonce);
      const signature = await wallet.sign(msg);
      await api("POST", "/wallet/link", { message: msg, signature, custodyAcknowledged: true });
      await qc.invalidateQueries({ queryKey: ["me"] });
      setResult({ tone: "positive", text: "Wallet linked." });
      onLinked?.();
    } catch (e) {
      setResult({
        tone: "negative",
        text:
          e instanceof ApiRequestError || e instanceof Error
            ? e.message.split("\n")[0]!
            : "Linking failed",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="s-stack">
      <CustodyExplanation />
      <label className="s-check">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>
          I understand that I keep custody of my wallet and that Suiem cannot recover it or move my
          funds.
        </span>
      </label>
      <label className="s-field">
        <span>Sign the linking message on</span>
        <select
          className="s-select"
          value={chainId}
          onChange={(e) => setChainId(Number(e.target.value) as 4663 | 46630)}
        >
          <option value={4663}>Mainnet (4663), used for $WIF votes</option>
          <option value={46630}>Testnet (46630), used for Stock Token trading</option>
        </select>
      </label>
      <div>
        <Button variant="primary" disabled={!ack} loading={busy} onClick={() => void link()}>
          Connect and link wallet
        </Button>
      </div>
      {!ack ? (
        <span className="s-small s-muted">
          Read and acknowledge the custody notice to continue.
        </span>
      ) : null}
      {result ? <Status tone={result.tone}>{result.text}</Status> : null}
    </div>
  );
}
