import { EmptyState, NetworkBadge } from "@suiem/ui";
import type { ReactNode } from "react";
import { PageHeader } from "./AppShell";

/** A real page with a proper empty state for features that arrive in a later sprint. */
export function Placeholder({
  title,
  intro,
  emptyTitle,
  sprint,
  network,
  children,
}: {
  title: string;
  intro: string;
  emptyTitle: string;
  sprint: number;
  network?: "mainnet" | "testnet";
  children?: ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} network={network}>
        {intro}
      </PageHeader>
      <EmptyState title={emptyTitle}>
        <span>
          This part of Suiem arrives in Sprint {sprint} of the hackathon build.{" "}
          {network ? (
            <>
              Actions here run on <NetworkBadge network={network} />.
            </>
          ) : null}
        </span>
      </EmptyState>
      {children}
    </>
  );
}
