"use client";
import { Card, EmptyState, NetworkBadge, Status } from "@suiem/ui";
import Link from "next/link";
import { PageHeader } from "../../../components/AppShell";
import { useMe } from "../../../lib/session";

export default function Home() {
  const me = useMe();
  const user = me.data;
  if (!user) return null;
  return (
    <>
      <PageHeader title={`Welcome${user.displayName ? `, ${user.displayName}` : ""}`}>
        Your research home. It is personalised by your interests, never by what you've bought, and
        never tells you what to buy.
      </PageHeader>
      <div className="grid2">
        <Card title="Your setup">
          <Status tone={user.requiredConsentsGranted ? "positive" : "warning"}>
            {user.requiredConsentsGranted ? "Terms & privacy accepted" : "Consent needed"}
          </Status>
          <Status tone={user.wallets.length ? "positive" : "neutral"}>
            {user.wallets.length
              ? `${user.wallets.length} wallet(s) linked`
              : "No wallet linked (optional)"}
          </Status>
          <Status tone={user.passkeyCount ? "positive" : "neutral"}>
            {user.passkeyCount ? "Passkey set up" : "No passkey yet"}
          </Status>
          <Link href="/settings">Manage in Settings</Link>
        </Card>
        <Card title="Interests">
          {user.interests.length ? (
            <div className="s-row">
              {user.interests.map((i) => (
                <span key={i} className="s-badge" data-tone="neutral">
                  {i.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          ) : (
            <span className="s-muted">
              You skipped interests. Add some in Settings to personalise Home.
            </span>
          )}
        </Card>
        <Card title="Networks">
          <span>
            <NetworkBadge network="mainnet" /> $WIF elections
          </span>
          <span>
            <NetworkBadge network="testnet" /> Stock Token demo (no value)
          </span>
          <span>
            <NetworkBadge network="offchain" /> research, theses, social, reputation
          </span>
        </Card>
      </div>
      <EmptyState title="No research yet" action={<Link href="/research">Go to Research</Link>}>
        Research briefs, watchlists and theses arrive in Sprint 4. Your saved items will show here.
      </EmptyState>
    </>
  );
}
