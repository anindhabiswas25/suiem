"use client";
import type { installationsResponse, pairingCodeResponse } from "@suiem/shared/schemas";
import { Button, Card, ErrorState, LoadingState, Status } from "@suiem/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { z } from "zod";
import { api, ApiRequestError } from "../lib/api";

type Installations = z.infer<typeof installationsResponse>;
type Pairing = z.infer<typeof pairingCodeResponse>;

/** Built into the web bundle at build time; the extension ID is not a secret. */
const EXTENSION_ID = process.env.NEXT_PUBLIC_EXTENSION_ID || "";

interface ChromeRuntime {
  sendMessage(id: string, msg: unknown, cb: (r: unknown) => void): void;
  lastError?: { message?: string };
}

function sendToExtension(id: string, code: string): Promise<boolean> {
  const rt = (globalThis as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
  if (!id || !rt?.sendMessage) return Promise.resolve(false);
  return new Promise((resolve) => {
    try {
      rt.sendMessage(id, { type: "suiem.pair", code }, (r) =>
        resolve(!rt.lastError && !!(r as { ok?: boolean } | undefined)?.ok),
      );
    } catch {
      resolve(false);
    }
  });
}

/** Settings → Browser extension: connect (one-time code), list and revoke installations. */
export function ExtensionSettings() {
  const list = useQuery<Installations>({
    queryKey: ["extension-installations"],
    queryFn: () => api("GET", "/extension/installations"),
  });
  const [pairing, setPairing] = useState<Pairing | null>(null);
  const [sent, setSent] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: "positive" | "negative"; text: string } | null>(null);

  async function connect() {
    setBusy("connect");
    setMsg(null);
    try {
      const p = await api<Pairing>("POST", "/extension/pairing-codes", {});
      setPairing(p);
      setSent(await sendToExtension(p.extensionId ?? EXTENSION_ID, p.code));
    } catch (e) {
      setMsg({
        tone: "negative",
        text: e instanceof ApiRequestError ? e.message : "Could not create a code",
      });
    } finally {
      setBusy(null);
    }
  }

  async function revoke(id: string) {
    setBusy(id);
    try {
      await api("DELETE", `/extension/installations/${id}`);
      await list.refetch();
      setMsg({
        tone: "positive",
        text: "Extension disconnected. Its token stopped working immediately.",
      });
    } catch (e) {
      setMsg({
        tone: "negative",
        text: e instanceof ApiRequestError ? e.message : "Could not disconnect",
      });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card title="Browser extension">
      <span className="s-muted">
        Suiem Intelligence notices companies on sites you choose and offers research when you ask.
        It never buys anything and sends nothing without your action.
      </span>
      <div>
        <Button variant="primary" loading={busy === "connect"} onClick={() => void connect()}>
          Connect extension
        </Button>
      </div>
      {pairing ? (
        <div className="s-stack" style={{ gap: 6 }}>
          <span>
            One-time code (valid 5 minutes, single use):{" "}
            <strong className="s-mono" data-testid="pairing-code">
              {pairing.code}
            </strong>
          </span>
          {sent ? (
            <Status tone="positive">
              Sent to your extension. Confirm your handle in the extension's options page.
            </Status>
          ) : (
            <span className="s-small s-muted">
              Open the extension's Options → Account and paste this code.
            </span>
          )}
        </div>
      ) : null}
      {list.isPending ? <LoadingState /> : null}
      {list.isError ? (
        <ErrorState
          message="Could not load connected extensions."
          retry={() => void list.refetch()}
        />
      ) : null}
      {list.data ? (
        list.data.items.length === 0 ? (
          <span className="s-muted">No extensions connected.</span>
        ) : (
          <ul className="s-stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {list.data.items.map((i) => (
              <li key={i.id} className="s-row" style={{ justifyContent: "space-between" }}>
                <span>
                  {i.label ?? "Extension"}{" "}
                  <span className="s-small s-muted">
                    connected {new Date(i.createdAt).toLocaleString()}
                    {i.lastSeenAt ? ` · last used ${new Date(i.lastSeenAt).toLocaleString()}` : ""}
                  </span>
                </span>
                <Button variant="danger" loading={busy === i.id} onClick={() => void revoke(i.id)}>
                  Revoke
                </Button>
              </li>
            ))}
          </ul>
        )
      ) : null}
      {msg ? <Status tone={msg.tone}>{msg.text}</Status> : null}
    </Card>
  );
}
