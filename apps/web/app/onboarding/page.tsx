"use client";
import {
  EXPERIENCE_LEVELS,
  INTERESTS,
  RESEARCH_DEPTHS,
  type consentsResponse,
} from "@suiem/shared/schemas";
import {
  Alert,
  Button,
  Card,
  ErrorState,
  LoadingState,
  NetworkBadge,
  Status,
  Steps,
  Wordmark,
} from "@suiem/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { Footer } from "../../components/AppShell";
import { WalletLink } from "../../components/WalletLink";
import { api, ApiRequestError } from "../../lib/api";
import { COUNTRIES } from "../../lib/countries";
import { useMe } from "../../lib/session";

type Consents = z.infer<typeof consentsResponse>;
const STEPS = [
  "Purpose",
  "Consent",
  "Country",
  "Wallet",
  "Interests",
  "Experience",
  "Extension",
  "Privacy",
] as const;
const label = (s: string) => s.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

/** PRD §5.1 onboarding. No wallet and no funding are required to finish. */
export default function Onboarding() {
  const me = useMe();
  const router = useRouter();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const consents = useQuery<Consents>({
    queryKey: ["consents"],
    queryFn: () => api("GET", "/me/consents"),
    enabled: !!me.data,
  });

  const [agree, setAgree] = useState({ terms: false, privacy: false, product_analytics: false });
  const [country, setCountry] = useState("");
  const [interests, setInterests] = useState<string[]>([]);
  const [experience, setExperience] = useState<string>("beginner");
  const [depth, setDepth] = useState<string>("plain_language");

  useEffect(() => {
    if (me.data === null) router.replace("/login?next=/onboarding");
    if (me.data?.onboardingCompletedAt) router.replace("/home");
    if (me.data?.jurisdiction) setCountry(me.data.jurisdiction);
  }, [me.data, router]);

  if (me.isPending || consents.isPending)
    return (
      <main id="main" className="public">
        <LoadingState />
      </main>
    );
  if (me.isError || consents.isError || !me.data || !consents.data) {
    return (
      <main id="main" className="public">
        <ErrorState message="Could not load your account." retry={() => void me.refetch()} />
      </main>
    );
  }

  const version = (purpose: string) =>
    consents.data.items.find((i) => i.purpose === purpose)?.currentPolicyVersion ?? "";
  const granted = (purpose: string) =>
    consents.data.items.find((i) => i.purpose === purpose)?.status === "granted";

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setStep((s) => s + 1);
    } catch (e) {
      setError(
        e instanceof ApiRequestError || e instanceof Error ? e.message : "Something went wrong",
      );
    } finally {
      setBusy(false);
    }
  }

  const saveConsents = () =>
    act(async () => {
      for (const purpose of [
        "terms",
        "privacy",
        ...(agree.product_analytics ? ["product_analytics"] : []),
      ]) {
        if (!granted(purpose))
          await api("POST", "/me/consents", {
            purpose,
            action: "granted",
            policyVersion: version(purpose),
          });
      }
      await consents.refetch();
    });
  const patch = (body: Record<string, unknown>) =>
    act(async () => void (await api("PATCH", "/me", body)));
  const finish = () =>
    act(async () => {
      await api("PATCH", "/me", { onboardingCompleted: true });
      await qc.invalidateQueries({ queryKey: ["me"] });
      router.replace("/home");
    });

  const back =
    step > 0 ? (
      <Button variant="ghost" onClick={() => setStep(step - 1)} disabled={busy}>
        Back
      </Button>
    ) : null;

  return (
    <>
      <main id="main" className="public">
        <Wordmark />
        <Steps total={STEPS.length} current={step} label="Onboarding" />
        <p className="s-small s-muted" style={{ margin: 0 }}>
          Step {step + 1} of {STEPS.length}: {STEPS[step]}
        </p>

        {step === 0 && (
          <Card title="What Suiem is">
            <p style={{ margin: 0 }}>
              Suiem helps you research companies you discover, save your reasoning as theses, learn
              from other investors, and recognise great research in community elections.
            </p>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li>Research, watchlists, theses and the social feed work without a wallet.</li>
              <li>
                The Stock Token demo runs on <NetworkBadge network="testnet" />. Test tokens have no
                value, are not securities, and the feature is unavailable in restricted
                jurisdictions (including the US, UK, Canada and Switzerland).
              </li>
              <li>
                Weekly elections use real $WIF on <NetworkBadge network="mainnet" />. Votes burn
                $WIF and are irreversible. Voting is optional.
              </li>
              <li>Nothing on Suiem is investment advice. Suiem never buys anything for you.</li>
            </ul>
            <div className="s-row">
              <Button variant="primary" onClick={() => setStep(1)}>
                Continue
              </Button>
            </div>
          </Card>
        )}

        {step === 1 && (
          <Card title="Terms and privacy">
            <p className="s-muted" style={{ margin: 0 }}>
              Your choices are stored with the policy version and the time you made them. You can
              review them in Settings.
            </p>
            {(["terms", "privacy"] as const).map((p) => (
              <label key={p} className="s-check">
                <input
                  type="checkbox"
                  checked={agree[p] || granted(p)}
                  disabled={granted(p)}
                  onChange={(e) => setAgree({ ...agree, [p]: e.target.checked })}
                />
                <span>
                  I accept the{" "}
                  <Link href={`/help#${p}`}>
                    {p === "terms" ? "Terms of Service" : "Privacy Notice"}
                  </Link>{" "}
                  (version {version(p)}). <em>Required.</em>
                </span>
              </label>
            ))}
            <label className="s-check">
              <input
                type="checkbox"
                checked={agree.product_analytics}
                onChange={(e) => setAgree({ ...agree, product_analytics: e.target.checked })}
              />
              <span>
                Optional: help improve Suiem with privacy-preserving product analytics. Off by
                default.
              </span>
            </label>
            <div className="s-row">
              {back}
              <Button
                variant="primary"
                loading={busy}
                disabled={
                  !((agree.terms || granted("terms")) && (agree.privacy || granted("privacy")))
                }
                onClick={() => void saveConsents()}
              >
                Accept and continue
              </Button>
            </div>
          </Card>
        )}

        {step === 2 && (
          <Card title="Where are you based?">
            <p className="s-muted" style={{ margin: 0 }}>
              Used only to decide which features are available to you. Stock Token features are
              blocked server-side in restricted jurisdictions and when no country is declared.
            </p>
            <label className="s-field">
              <span>Country</span>
              <select
                className="s-select"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
              >
                <option value="">Choose…</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="s-row">
              {back}
              <Button
                variant="primary"
                loading={busy}
                disabled={!country}
                onClick={() => void patch({ jurisdiction: country })}
              >
                Continue
              </Button>
            </div>
          </Card>
        )}

        {step === 3 && (
          <Card title="Connect a wallet (optional)">
            {me.data.wallets.length > 0 ? (
              <Status tone="positive">
                You already have {me.data.wallets.length} linked wallet(s).
              </Status>
            ) : null}
            <p className="s-muted" style={{ margin: 0 }}>
              You only need a wallet to vote in $WIF elections or try the testnet Stock Token demo.
              You can skip this and do it later in Settings.
            </p>
            <WalletLink />
            <div className="s-row">
              {back}
              <Button variant="primary" onClick={() => setStep(4)}>
                {me.data.wallets.length > 0 ? "Continue" : "Skip for now"}
              </Button>
            </div>
          </Card>
        )}

        {step === 4 && (
          <Card title="What are you interested in?">
            <p className="s-muted" style={{ margin: 0 }}>
              Optional. Shapes your home page; it never triggers anything financial. You can change
              it any time.
            </p>
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
                  {label(i)}
                </button>
              ))}
            </div>
            <div className="s-row">
              {back}
              <Button onClick={() => void patch({ interestsSkipped: true })} loading={busy}>
                Skip
              </Button>
              <Button
                variant="primary"
                disabled={interests.length === 0}
                loading={busy}
                onClick={() => void patch({ interests })}
              >
                Save interests
              </Button>
            </div>
          </Card>
        )}

        {step === 5 && (
          <Card title="Your experience">
            <label className="s-field">
              <span>Investing experience</span>
              <select
                className="s-select"
                value={experience}
                onChange={(e) => setExperience(e.target.value)}
              >
                {EXPERIENCE_LEVELS.map((x) => (
                  <option key={x} value={x}>
                    {label(x)}
                  </option>
                ))}
              </select>
            </label>
            <label className="s-field">
              <span>How should research read?</span>
              <select className="s-select" value={depth} onChange={(e) => setDepth(e.target.value)}>
                {RESEARCH_DEPTHS.map((x) => (
                  <option key={x} value={x}>
                    {label(x)}
                  </option>
                ))}
              </select>
            </label>
            <div className="s-row">
              {back}
              <Button
                variant="primary"
                loading={busy}
                onClick={() => void patch({ experienceLevel: experience, researchDepth: depth })}
              >
                Continue
              </Button>
            </div>
          </Card>
        )}

        {step === 6 && (
          <Card title="Suiem Intelligence browser extension">
            <p style={{ margin: 0 }}>
              An optional Chrome extension that notices companies on sites <em>you</em> choose (for
              example x.com) and offers research when you ask. It can be turned OFF, PAUSED or put
              in Private mode at any time, and it never buys anything.
            </p>
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              <li>
                Install it from the Suiem release (see the extension README: load unpacked in{" "}
                <code>chrome://extensions</code>).
              </li>
              <li>
                Then connect it in <Link href="/settings">Settings → Browser extension</Link>.
              </li>
            </ol>
            <Alert>Nothing is installed or requested now. You can skip this.</Alert>
            <div className="s-row">
              {back}
              <Button variant="primary" onClick={() => setStep(7)}>
                Continue
              </Button>
            </div>
          </Card>
        )}

        {step === 7 && (
          <Card title="Your privacy controls">
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              <li>
                Your portfolio, positions, transactions and linked wallets are private by default.
              </li>
              <li>Theses and research are private until you choose to publish them.</li>
              <li>You'll find privacy settings, data export and account deletion in Settings.</li>
              <li>Suiem never puts your private data onchain and never sells browsing data.</li>
            </ul>
            <div className="s-row">
              {back}
              <Button variant="primary" loading={busy} onClick={() => void finish()}>
                Finish and go to Home
              </Button>
            </div>
          </Card>
        )}

        {error ? <Status tone="negative">{error}</Status> : null}
      </main>
      <Footer />
    </>
  );
}
