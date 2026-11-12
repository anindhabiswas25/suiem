"use client";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { robinhoodMainnet, robinhoodTestnet } from "@suiem/config/chains";
import type { siweNonceResponse } from "@suiem/shared/schemas";
import { Button, NetworkBadge, Status } from "@suiem/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createSiweMessage } from "viem/siwe";
import { useConnect, useConnection, useConnectors, useSignMessage, useSwitchChain } from "wagmi";
import type { z } from "zod";
import { api, ApiRequestError } from "../lib/api";

type Nonce = z.infer<typeof siweNonceResponse>;
const message = (e: unknown) =>
  e instanceof ApiRequestError
    ? e.message
    : e instanceof Error
      ? (e.message.split("\n")[0] ?? e.message)
      : "Something went wrong";

export function buildSiweMessage(address: `0x${string}`, nonce: Nonce) {
  return createSiweMessage({
    address,
    chainId: nonce.chainId,
    domain: nonce.domain,
    uri: nonce.uri,
    nonce: nonce.nonce,
    version: "1",
    statement: nonce.statement,
    issuedAt: new Date(nonce.issuedAt),
    expirationTime: new Date(nonce.expirationTime),
  });
}

/** Connect an injected wallet on the chosen chain and return its address. */
export function useWalletSigner() {
  const connection = useConnection();
  const connect = useConnect();
  const connectors = useConnectors();
  const switchChain = useSwitchChain();
  const sign = useSignMessage();
  return {
    async ensure(chainId: 4663 | 46630): Promise<`0x${string}`> {
      let address = connection.address;
      let current = connection.chainId;
      if (!connection.isConnected) {
        const connector = connectors[0];
        if (!connector)
          throw new Error(
            "No browser wallet found. Install MetaMask, Rabby or another EIP-1193 wallet.",
          );
        const r = await connect.mutateAsync({ connector, chainId });
        address = r.accounts[0];
        current = r.chainId;
      }
      if (current !== chainId) await switchChain.mutateAsync({ chainId });
      if (!address) throw new Error("Wallet did not return an address");
      return address;
    },
    sign: (msg: string) => sign.mutateAsync({ message: msg }),
  };
}

function ChainChoice({
  value,
  onChange,
}: {
  value: 4663 | 46630;
  onChange: (v: 4663 | 46630) => void;
}) {
  return (
    <fieldset className="s-stack" style={{ border: 0, padding: 0, margin: 0, gap: 8 }}>
      <legend className="s-small s-muted" style={{ marginBottom: 6 }}>
        Sign the message on
      </legend>
      {[
        {
          id: robinhoodMainnet.id as 4663,
          network: "mainnet" as const,
          label: "Robinhood Chain mainnet (4663), where $WIF votes happen",
        },
        {
          id: robinhoodTestnet.id as 46630,
          network: "testnet" as const,
          label: "Robinhood Chain testnet (46630), for Stock Token trading",
        },
      ].map((c) => (
        <label key={c.id} className="s-check">
          <input
            type="radio"
            name="siwe-chain"
            checked={value === c.id}
            onChange={() => onChange(c.id)}
          />
          <span className="s-stack" style={{ gap: 2 }}>
            <span>{c.label}</span>
            <NetworkBadge network={c.network} />
          </span>
        </label>
      ))}
    </fieldset>
  );
}

/** "Sign in with Ethereum": a free signature, never a transaction. */
export function SiweLogin({ onDone }: { onDone: (r: { isNewUser: boolean }) => void }) {
  const [chainId, setChainId] = useState<4663 | 46630>(46630);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wallet = useWalletSigner();
  const qc = useQueryClient();

  async function run() {
    setBusy(true);
    setError(null);
    try {
      const address = await wallet.ensure(chainId);
      const nonce = await api<Nonce>("POST", "/auth/siwe/nonce", { chainId });
      const msg = buildSiweMessage(address, nonce);
      const signature = await wallet.sign(msg);
      const r = await api<{ isNewUser: boolean }>("POST", "/auth/siwe/verify", {
        message: msg,
        signature,
      });
      await qc.invalidateQueries({ queryKey: ["me"] });
      onDone(r);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="s-stack">
      <ChainChoice value={chainId} onChange={setChainId} />
      <p className="s-small s-muted" style={{ margin: 0 }}>
        You'll sign a short message. It is <strong>not a transaction</strong> and costs no gas.
        Suiem never sees your private key.
      </p>
      <Button variant="primary" loading={busy} onClick={() => void run()}>
        Sign in with wallet
      </Button>
      {error ? <Status tone="negative">{error}</Status> : null}
    </div>
  );
}

export function PasskeyLogin({ onDone }: { onDone: (r: { isNewUser: boolean }) => void }) {
  const [busy, setBusy] = useState<"signup" | "login" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();

  async function signup() {
    setBusy("signup");
    setError(null);
    try {
      const { options } = await api<{
        options: Parameters<typeof startRegistration>[0]["optionsJSON"];
      }>("POST", "/auth/passkey/register/options", {});
      const response = await startRegistration({ optionsJSON: options });
      const r = await api<{ isNewUser: boolean }>("POST", "/auth/passkey/register/verify", {
        response,
      });
      await qc.invalidateQueries({ queryKey: ["me"] });
      onDone(r);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  async function login() {
    setBusy("login");
    setError(null);
    try {
      const { options } = await api<{
        options: Parameters<typeof startAuthentication>[0]["optionsJSON"];
      }>("POST", "/auth/passkey/login/options", {});
      const response = await startAuthentication({ optionsJSON: options });
      const r = await api<{ isNewUser: boolean }>("POST", "/auth/passkey/login/verify", {
        response,
      });
      await qc.invalidateQueries({ queryKey: ["me"] });
      onDone(r);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="s-stack">
      <p className="s-small s-muted" style={{ margin: 0 }}>
        Use Face ID, Touch ID, Windows Hello or a security key. No password, no wallet needed.
      </p>
      <div className="s-row">
        <Button
          variant="primary"
          loading={busy === "signup"}
          disabled={busy !== null}
          onClick={() => void signup()}
        >
          Create account with passkey
        </Button>
        <Button loading={busy === "login"} disabled={busy !== null} onClick={() => void login()}>
          Sign in with passkey
        </Button>
      </div>
      {error ? <Status tone="negative">{error}</Status> : null}
    </div>
  );
}
