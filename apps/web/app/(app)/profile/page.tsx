"use client";
import { Card, EmptyState, Status } from "@suiem/ui";
import Link from "next/link";
import { PageHeader } from "../../../components/AppShell";
import { useMe } from "../../../lib/session";

export default function Profile() {
  const me = useMe();
  if (!me.data) return null;
  return (
    <>
      <PageHeader title={me.data.displayName ?? me.data.handle}>@{me.data.handle}</PageHeader>
      <Card title="Suiem Score">
        <Status tone="neutral">Building track record</Status>
        <span className="s-muted">
          The 50/50 score (investor process + community contribution) appears once there is enough
          evidence. $WIF holdings and votes never affect it.
        </span>
      </Card>
      <Card title="Privacy">
        <span className="s-muted">
          Portfolio, positions, transactions, research activity and linked wallets are private by
          default.
        </span>
        <Link href="/settings#privacy">Change privacy settings</Link>
      </Card>
      <EmptyState title="No published research yet">
        Published theses and research appear here from Sprint 6.
      </EmptyState>
    </>
  );
}
