"use client";
import type {
  briefListResponse,
  thesisListResponse,
  watchlistsResponse,
} from "@suiem/shared/schemas";
import { Card, EmptyState, NetworkBadge, Status } from "@suiem/ui";
import { useQuery } from "@tanstack/react-query";
import type { z } from "zod";
import { api } from "../../../lib/api";
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
      <HomeResearch />
    </>
  );
}

function HomeResearch() {
  const briefs = useQuery<z.infer<typeof briefListResponse>>({
    queryKey: ["briefs", "home"],
    queryFn: () => api("GET", "/research/briefs?limit=5"),
  });
  const lists = useQuery<z.infer<typeof watchlistsResponse>>({
    queryKey: ["watchlists"],
    queryFn: () => api("GET", "/watchlists"),
  });
  const theses = useQuery<z.infer<typeof thesisListResponse>>({
    queryKey: ["theses"],
    queryFn: () => api("GET", "/theses"),
  });
  const empty =
    briefs.data?.items.length === 0 &&
    theses.data?.items.length === 0 &&
    (lists.data?.items ?? []).every((l) => l.items.length === 0);
  if (empty)
    return (
      <EmptyState title="No research yet" action={<Link href="/research">Go to Research</Link>}>
        Search a company, request a cited AI brief, add it to a watchlist and write your own thesis.
      </EmptyState>
    );
  return (
    <div className="grid2">
      <Card title="Latest briefs">
        {briefs.data?.items.map((b) => (
          <Link key={b.id} href={`/research/${encodeURIComponent(b.entityId)}`}>
            {b.entityName}{" "}
            <span className="s-small s-muted">
              · {new Date(b.generatedAt).toLocaleDateString()}
            </span>
          </Link>
        ))}
        <Link href="/research" className="s-small">
          All research
        </Link>
      </Card>
      <Card title="Watchlists">
        {lists.data?.items.map((l) => (
          <span key={l.id}>
            <strong>{l.name}</strong>{" "}
            <span className="s-small s-muted">
              · {l.items.map((i) => i.name).join(", ") || "empty"}
            </span>
          </span>
        ))}
        <Link href="/watchlist" className="s-small">
          Manage watchlists
        </Link>
      </Card>
      <Card title="Your theses">
        {theses.data?.items.length === 0 ? (
          <span className="s-muted s-small">None yet. Start one from a research page.</span>
        ) : null}
        {theses.data?.items.slice(0, 5).map((t) => (
          <Link key={t.id} href={`/theses/${t.id}`}>
            {t.title}{" "}
            <span className="s-small s-muted">
              · {t.entityName} · {t.direction} · {t.visibility}
            </span>
          </Link>
        ))}
      </Card>
    </div>
  );
}
