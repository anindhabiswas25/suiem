"use client";
import { Alert, EmptyState, ErrorState, LoadingState, Status } from "@suiem/ui";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { PageHeader } from "../../../components/AppShell";
import { api } from "../../../lib/api";

interface Eligibility {
  eligible: boolean;
  reason?: "restricted_jurisdiction" | "jurisdiction_not_declared";
}

export default function Portfolio() {
  const q = useQuery<Eligibility>({
    queryKey: ["eligibility"],
    queryFn: () => api("GET", "/invest/eligibility"),
  });
  return (
    <>
      <PageHeader title="Portfolio" network="testnet">
        Simulated and testnet positions, always shown separately. Testnet Stock Tokens have no value
        and are not securities or shares.
      </PageHeader>
      {q.isPending ? <LoadingState label="Checking availability…" /> : null}
      {q.isError ? (
        <ErrorState message="Could not check availability." retry={() => void q.refetch()} />
      ) : null}
      {q.data && !q.data.eligible ? (
        <Alert tone="negative">
          <Status tone="negative">Stock Token features are unavailable</Status>
          <p style={{ margin: "6px 0 0" }}>
            {q.data.reason === "restricted_jurisdiction"
              ? "They are not offered in your jurisdiction. Research, theses and elections remain available."
              : "Declare your country in Settings to check availability."}{" "}
            <Link href="/help">Why?</Link>
          </p>
        </Alert>
      ) : null}
      {q.data?.eligible ? (
        <Status tone="positive">Stock Token demo available in your jurisdiction</Status>
      ) : null}
      <EmptyState title="No positions yet">
        The testnet order flow and simulated book arrive in Sprint 5.
      </EmptyState>
    </>
  );
}
