"use client";
import type { thesisResponse } from "@suiem/shared/schemas";
import { Alert, Button, Card, ErrorState, LoadingState, Status } from "@suiem/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import type { z } from "zod";
import { PageHeader } from "../../../../components/AppShell";
import { type ThesisFields, ThesisEditor } from "../../../../components/research/ThesisEditor";
import { api, ApiRequestError } from "../../../../lib/api";

type Thesis = z.infer<typeof thesisResponse>;
type Version = Thesis["versions"][number];

const VIS = { private: "Only me", followers: "My followers", public: "Everyone" } as const;

export default function ThesisPage() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const t = useQuery<Thesis>({
    queryKey: ["thesis", id],
    queryFn: () => api("GET", `/theses/${id}`),
  });
  const [editing, setEditing] = useState(false);
  const refresh = (data: Thesis) => {
    qc.setQueryData(["thesis", id], data);
    void qc.invalidateQueries({ queryKey: ["theses"] });
  };
  const update = useMutation({
    mutationFn: (f: ThesisFields) => api<Thesis>("PATCH", `/theses/${id}`, f),
    onSuccess: (d) => (refresh(d), setEditing(false)),
  });
  const publish = useMutation({
    mutationFn: (visibility: keyof typeof VIS) =>
      api<Thesis>("POST", `/theses/${id}/publish`, { visibility }),
    onSuccess: refresh,
  });
  if (t.isPending) return <LoadingState />;
  if (t.isError || !t.data)
    return <ErrorState title="Thesis not found" message="It may be private or deleted." />;
  const d = t.data;
  const current = d.versions.find((v) => v.version === d.currentVersion) ?? d.versions.at(-1)!;
  const older = d.versions.filter((v) => v.version !== current.version).reverse();
  return (
    <>
      <PageHeader title={current.title}>
        <Link href={`/research/${encodeURIComponent(d.entityId)}`}>{d.entityName}</Link> ·{" "}
        {current.direction} · {current.horizonDays} days · version {d.currentVersion}
        {d.owner.isMe ? "" : ` · by @${d.owner.handle}`}
      </PageHeader>
      <div className="s-row">
        <Status tone={d.visibility === "private" ? "neutral" : "positive"}>
          Visible to: {VIS[d.visibility]}
        </Status>
        <Status tone="warning">Personal view, not investment advice</Status>
      </div>
      {d.owner.isMe ? (
        <Card title="Visibility">
          <span className="s-small">
            Nothing is public by default. Publishing shares the current version; the full history
            stays yours.
          </span>
          <div className="s-row">
            {(Object.keys(VIS) as (keyof typeof VIS)[]).map((v) => (
              <Button
                key={v}
                variant={d.visibility === v ? "primary" : "secondary"}
                onClick={() => publish.mutate(v)}
                loading={publish.isPending && publish.variables === v}
                data-testid={`visibility-${v}`}
              >
                {VIS[v]}
              </Button>
            ))}
          </div>
          {publish.isError ? (
            <Alert tone="negative">
              {publish.error instanceof ApiRequestError
                ? publish.error.message
                : "Could not change visibility."}
            </Alert>
          ) : null}
        </Card>
      ) : null}
      {editing ? (
        <ThesisEditor
          entityId={d.entityId}
          initial={{
            direction: current.direction,
            horizonDays: current.horizonDays,
            title: current.title,
            rationale: current.rationale,
            evidence: current.evidence.map((e) => ({ briefId: e.briefId, claimId: e.claimId })),
            counterarguments: current.counterarguments,
            risks: current.risks,
            invalidation: current.invalidation,
          }}
          saveLabel={`Save as version ${d.currentVersion + 1}`}
          saving={update.isPending}
          onSave={(f) => update.mutate(f)}
          error={update.error}
        />
      ) : (
        <VersionCard v={current} title={`Current version (v${current.version})`} />
      )}
      {d.owner.isMe && !editing ? (
        <div className="s-row">
          <Button onClick={() => setEditing(true)} data-testid="edit-thesis">
            Edit (creates version {d.currentVersion + 1})
          </Button>
        </div>
      ) : null}
      {d.owner.isMe ? <Review thesis={d} onDone={refresh} /> : null}
      {older.length ? (
        <Card title="Version history (read-only)">
          {older.map((v) => (
            <div key={v.version} className="version-old">
              <VersionBody
                v={v}
                heading={`v${v.version} · ${new Date(v.createdAt).toLocaleString()}`}
              />
            </div>
          ))}
        </Card>
      ) : null}
    </>
  );
}

function VersionCard({ v, title }: { v: Version; title: string }) {
  return (
    <Card title={title}>
      <VersionBody v={v} />
    </Card>
  );
}

function VersionBody({ v, heading }: { v: Version; heading?: string }) {
  return (
    <div className="s-stack" style={{ gap: 6 }} data-testid="thesis-version">
      {heading ? <strong>{heading}</strong> : null}
      {heading ? <span>{v.title}</span> : null}
      <span className="s-small s-muted">
        {v.direction} · {v.horizonDays} days ·{" "}
        {v.priceContext
          ? `price when written: USD ${v.priceContext.price} at ${new Date(v.priceContext.asOf).toLocaleString()} (${v.priceContext.source})`
          : "price unavailable when written"}
      </span>
      <div>
        <strong>Rationale.</strong> {v.rationale}
      </div>
      {v.evidence.length ? (
        <div>
          <strong>Evidence from research:</strong>
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            {v.evidence.map((e) => (
              <li key={`${e.briefId}${e.claimId}`} className="s-small">
                {e.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div>
        <strong>Counterarguments.</strong> {v.counterarguments}
      </div>
      <div>
        <strong>Risks.</strong> {v.risks}
      </div>
      <div>
        <strong>What would prove it wrong.</strong> {v.invalidation}
      </div>
    </div>
  );
}

function Review({ thesis, onDone }: { thesis: Thesis; onDone: (t: Thesis) => void }) {
  const [outcome, setOutcome] = useState<"played_out" | "did_not_play_out" | "mixed" | "too_early">(
    "too_early",
  );
  const [note, setNote] = useState("");
  const add = useMutation({
    mutationFn: () => api<Thesis>("POST", `/theses/${thesis.id}/review`, { outcome, note }),
    onSuccess: (t) => (onDone(t), setNote("")),
  });
  return (
    <Card title="Outcome reviews">
      <span className="s-small s-muted">
        Reviews are added alongside the thesis; the original versions never change.
      </span>
      {thesis.reviews.map((r) => (
        <div key={r.id} className="s-small">
          <strong>{r.outcome.replace(/_/g, " ")}</strong> ·{" "}
          {new Date(r.createdAt).toLocaleDateString()}: {r.note}
        </div>
      ))}
      <div className="s-row">
        <select
          className="s-select"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as typeof outcome)}
          aria-label="Outcome"
        >
          <option value="too_early">Too early to tell</option>
          <option value="played_out">Played out</option>
          <option value="did_not_play_out">Did not play out</option>
          <option value="mixed">Mixed</option>
        </select>
        <input
          className="s-input"
          style={{ flex: 1 }}
          value={note}
          maxLength={4000}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What happened?"
        />
        <Button onClick={() => add.mutate()} disabled={!note.trim()} loading={add.isPending}>
          Add review
        </Button>
      </div>
    </Card>
  );
}
