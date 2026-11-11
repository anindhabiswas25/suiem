"use client";
import { startRegistration } from "@simplewebauthn/browser";
import { INTERESTS, type consentsResponse } from "@suiem/shared/schemas";
import { Alert, Button, Card, ErrorState, LoadingState, NetworkBadge, Status } from "@suiem/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { PageHeader } from "../../../components/AppShell";
import { ExtensionSettings } from "../../../components/ExtensionSettings";
import { WalletLink } from "../../../components/WalletLink";
import { api, ApiRequestError } from "../../../lib/api";
import { COUNTRIES } from "../../../lib/countries";
import { useMe } from "../../../lib/session";

type Consents = z.infer<typeof consentsResponse>;
type Msg = { tone: "positive" | "negative"; text: string } | null;
const errText = (e: unknown) =>
  e instanceof ApiRequestError || e instanceof Error
    ? e.message.split("\n")[0]!
    : "Something went wrong";

function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => {
    setBusy(key);
    setMsg(null);
    try {
      await fn();
      setMsg({ tone: "positive", text: ok });
    } catch (e) {
      setMsg({ tone: "negative", text: errText(e) });
    } finally {
      setBusy(null);
    }
  };
  return { busy, msg, run };
}

export default function Settings() {
  const me = useMe();
  const qc = useQueryClient();
  const consents = useQuery<Consents>({
    queryKey: ["consents"],
    queryFn: () => api("GET", "/me/consents"),
  });
  const profile = useAction();
  const consentAct = useAction();
  const security = useAction();
  const walletAct = useAction();
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [interests, setInterests] = useState<string[]>([]);

  useEffect(() => {
    if (me.data) {
      setName(me.data.displayName ?? "");
      setCountry(me.data.jurisdiction ?? "");
      setInterests(me.data.interests);
    }
  }, [me.data]);

  if (me.isPending) return <LoadingState />;
  if (me.isError || !me.data)
    return <ErrorState message="Could not load settings." retry={() => void me.refetch()} />;
  const user = me.data;
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["me"] }),
      qc.invalidateQueries({ queryKey: ["consents"] }),
    ]);

  return (
    <>
      <PageHeader title="Settings">
        Your profile, sign-in methods, wallets, consents and data.
      </PageHeader>

      <Card title="Profile">
        <label className="s-field">
          <span>Display name</span>
          <input
            className="s-input"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder={user.handle}
          />
        </label>
        <label className="s-field">
          <span>Country (used for Stock Token availability)</span>
          <select className="s-select" value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">Choose…</option>
            {COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
          <span className="s-small s-muted">
            Why we ask: Robinhood's Stock Tokens may not be offered in some countries (the RHJ
            restricted jurisdictions list). Suiem checks your declared country on the server before
            showing any Stock Token feature, including the testnet demo. Paper trading and research
            work everywhere. We don't use your IP address to guess your location.
          </span>
        </label>
        <fieldset className="s-stack" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend style={{ fontWeight: 600, marginBottom: 6 }}>Interests</legend>
          <div className="s-row" role="group" aria-label="Interests">
            {INTERESTS.map((i) => (
              <button
                key={i}
                type="button"
                className="s-chip"
                aria-pressed={interests.includes(i)}
                onClick={() =>
                  setInterests(
                    interests.includes(i) ? interests.filter((x) => x !== i) : [...interests, i],
                  )
                }
              >
                {interests.includes(i) ? "✓ " : ""}
                {i.replace(/_/g, " ")}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="s-row">
          <Button
            variant="primary"
            loading={profile.busy === "save"}
            onClick={() =>
              void profile.run(
                "save",
                async () => {
                  await api("PATCH", "/me", {
                    displayName: name.trim() === "" ? null : name.trim(),
                    ...(country ? { jurisdiction: country } : {}),
                    ...(interests.length ? { interests } : { interestsSkipped: true }),
                  });
                  await refresh();
                },
                "Profile saved.",
              )
            }
          >
            Save profile
          </Button>
          <Status tone={user.stockTokenEligible ? "positive" : "neutral"}>
            {user.stockTokenEligible
              ? "Stock Token demo available"
              : "Stock Token demo unavailable for your country"}
          </Status>
        </div>
        {profile.msg ? <Status tone={profile.msg.tone}>{profile.msg.text}</Status> : null}
      </Card>

      <Card title="Sign-in methods">
        <span>
          Active: {user.authMethods.join(", ") || "none"} · Passkeys: {user.passkeyCount}
        </span>
        <div>
          <Button
            loading={security.busy === "passkey"}
            onClick={() =>
              void security.run(
                "passkey",
                async () => {
                  const { options } = await api<{
                    options: Parameters<typeof startRegistration>[0]["optionsJSON"];
                  }>("POST", "/auth/passkey/register/options", {});
                  const response = await startRegistration({ optionsJSON: options });
                  await api("POST", "/auth/passkey/register/verify", { response });
                  await refresh();
                },
                "Passkey added.",
              )
            }
          >
            Add a passkey
          </Button>
        </div>
        {security.msg ? <Status tone={security.msg.tone}>{security.msg.text}</Status> : null}
      </Card>

      <Card title="Wallets">
        {user.wallets.length === 0 ? <span className="s-muted">No wallets linked.</span> : null}
        <ul className="s-stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {user.wallets.map((w) => (
            <li key={w.id} className="s-row">
              <span className="s-mono">{w.address}</span>
              <NetworkBadge network={w.chainId === 4663 ? "mainnet" : "testnet"} />
              <Button
                variant="danger"
                loading={walletAct.busy === w.id}
                onClick={() =>
                  void walletAct.run(
                    w.id,
                    async () => {
                      await api("DELETE", `/wallet/link/${w.id}`);
                      await refresh();
                    },
                    "Wallet unlinked.",
                  )
                }
              >
                Unlink
              </Button>
            </li>
          ))}
        </ul>
        {walletAct.msg ? <Status tone={walletAct.msg.tone}>{walletAct.msg.text}</Status> : null}
        <details>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>Link another wallet</summary>
          <div style={{ marginTop: 12 }}>
            <WalletLink onLinked={() => void refresh()} />
          </div>
        </details>
      </Card>

      <ExtensionSettings />

      <Card title="Consents">
        {consents.isPending ? <LoadingState /> : null}
        {consents.isError ? (
          <ErrorState message="Could not load consents." retry={() => void consents.refetch()} />
        ) : null}
        {consents.data ? (
          <ul className="s-stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {consents.data.items.map((c) => (
              <li key={c.purpose} className="s-row" style={{ justifyContent: "space-between" }}>
                <span className="s-stack" style={{ gap: 2 }}>
                  <strong>{c.title}</strong>
                  <span className="s-small s-muted">
                    {c.status === "granted"
                      ? `Granted (version ${c.policyVersion}) on ${new Date(c.updatedAt!).toLocaleString()}`
                      : c.status.replace("_", " ")}
                    {c.required ? " · required" : ""}
                    {!c.available ? " · not available yet" : ""}
                  </span>
                </span>
                {c.required ? (
                  <span className="s-small s-muted">To withdraw, delete your account below.</span>
                ) : c.available ? (
                  <Button
                    loading={consentAct.busy === c.purpose}
                    onClick={() =>
                      void consentAct.run(
                        c.purpose,
                        async () => {
                          await api("POST", "/me/consents", {
                            purpose: c.purpose,
                            action: c.status === "granted" ? "withdrawn" : "granted",
                            policyVersion: c.currentPolicyVersion,
                          });
                          await refresh();
                        },
                        "Consent updated.",
                      )
                    }
                  >
                    {c.status === "granted" ? "Withdraw" : "Allow"}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {consentAct.msg ? <Status tone={consentAct.msg.tone}>{consentAct.msg.text}</Status> : null}
      </Card>

      <Card title="Privacy and your data">
        <div id="privacy" className="s-stack">
          <span>
            Portfolio, positions, transactions, research activity and linked wallets are private by
            default. Per-field visibility controls arrive with Social (Sprint 6).
          </span>
          <Alert>
            Data export and account deletion are being built. They will be available before the
            public demo (Sprint 8).
          </Alert>
          <div className="s-row">
            <Button disabled aria-describedby="data-stub">
              Export my data
            </Button>
            <Button variant="danger" disabled aria-describedby="data-stub">
              Delete my account
            </Button>
          </div>
          <span id="data-stub" className="s-small s-muted">
            Not yet available in this build.
          </span>
        </div>
      </Card>
    </>
  );
}
