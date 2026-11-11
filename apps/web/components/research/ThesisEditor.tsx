"use client";
import type { briefListResponse, briefResponse, thesisDraftResponse } from "@suiem/shared/schemas";
import { Alert, Button, Card, Status } from "@suiem/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { z } from "zod";
import { api, ApiRequestError } from "../../lib/api";
import type { Brief } from "./ui";

export interface ThesisFields {
  direction: "bullish" | "bearish" | "neutral";
  horizonDays: number;
  title: string;
  rationale: string;
  evidence: { briefId: string; claimId: string }[];
  counterarguments: string;
  risks: string;
  invalidation: string;
}

export const EMPTY_THESIS: ThesisFields = {
  direction: "neutral",
  horizonDays: 365,
  title: "",
  rationale: "",
  evidence: [],
  counterarguments: "",
  risks: "",
  invalidation: "",
};

const SECTIONS: [keyof Brief, string][] = [
  ["financialHighlights", "Financials"],
  ["valuation", "Valuation"],
  ["businessModel", "Business model"],
  ["industryContext", "Industry"],
  ["competitors", "Competitors"],
  ["recentDevelopments", "News"],
  ["risks", "Risks"],
  ["bullCase", "Bull case"],
  ["baseCase", "Base case"],
  ["bearCase", "Bear case"],
];

/** Thesis form with optional AI drafting help. The draft only fills the form; saving is explicit. */
export function ThesisEditor({
  entityId,
  briefId: initialBriefId,
  initial,
  saveLabel,
  saving,
  onSave,
  error,
}: {
  entityId: string;
  briefId?: string | null;
  initial: ThesisFields;
  saveLabel: string;
  saving: boolean;
  onSave: (f: ThesisFields) => void;
  error?: unknown;
}) {
  const [f, setF] = useState<ThesisFields>(initial);
  const [aiUsed, setAiUsed] = useState<string | null>(null);
  const latest = useQuery<z.infer<typeof briefListResponse>>({
    queryKey: ["briefs", entityId, "latest"],
    queryFn: () => api("GET", `/research/briefs?entityId=${encodeURIComponent(entityId)}&limit=1`),
    enabled: !initialBriefId,
  });
  const briefId =
    initialBriefId ?? initial.evidence[0]?.briefId ?? latest.data?.items[0]?.id ?? null;
  const brief = useQuery<z.infer<typeof briefResponse>>({
    queryKey: ["brief", briefId],
    queryFn: () => api("GET", `/research/briefs/${briefId}`),
    enabled: !!briefId,
  });
  const draft = useMutation({
    mutationFn: () =>
      api<z.infer<typeof thesisDraftResponse>>("POST", "/research/theses/draft", {
        briefId,
        direction: f.title ? f.direction : undefined,
      }),
    onSuccess: (d) => {
      setF({
        direction: d.direction,
        horizonDays: d.horizonDays,
        title: d.title,
        rationale: d.rationale,
        counterarguments: d.counterarguments,
        risks: d.risks,
        invalidation: d.invalidation,
        evidence: d.evidence.map((e) => ({ briefId: e.briefId, claimId: e.claimId })),
      });
      setAiUsed(`${d.model} via ${d.provider === "groq" ? "Groq" : "Google Gemini"}`);
    },
  });
  const set = <K extends keyof ThesisFields>(k: K, v: ThesisFields[K]) => setF({ ...f, [k]: v });
  const b = brief.data?.brief as unknown as Brief | undefined;
  const toggle = (claimId: string) => {
    if (!briefId) return;
    const has = f.evidence.some((e) => e.briefId === briefId && e.claimId === claimId);
    set(
      "evidence",
      has
        ? f.evidence.filter((e) => !(e.briefId === briefId && e.claimId === claimId))
        : [...f.evidence, { briefId, claimId }].slice(0, 10),
    );
  };
  const valid =
    f.title.trim().length >= 3 &&
    f.rationale.trim() &&
    f.counterarguments.trim() &&
    f.risks.trim() &&
    f.invalidation.trim();
  const area = (
    k: "rationale" | "counterarguments" | "risks" | "invalidation",
    label: string,
    hint: string,
  ) => (
    <div className="s-field">
      <label htmlFor={`t-${k}`}>{label}</label>
      <textarea
        id={`t-${k}`}
        className="s-input"
        rows={3}
        value={f[k]}
        onChange={(e) => set(k, e.target.value)}
        maxLength={k === "invalidation" ? 2000 : 4000}
        placeholder={hint}
        data-testid={`thesis-${k}`}
      />
    </div>
  );
  return (
    <Card title="Your thesis">
      {briefId ? (
        <div className="s-row">
          <Button onClick={() => draft.mutate()} loading={draft.isPending} data-testid="ai-draft">
            Draft with AI from the brief
          </Button>
          <span className="s-small s-muted">
            The AI only drafts wording from the brief's cited claims. You decide; nothing is saved
            until you click {saveLabel}.
          </span>
        </div>
      ) : (
        <span className="s-small s-muted">
          Request a research brief for this company to use AI drafting help and pick evidence.
        </span>
      )}
      {draft.isError ? (
        <Alert tone="negative">
          {draft.error instanceof ApiRequestError ? draft.error.message : "Drafting failed."}
        </Alert>
      ) : null}
      {aiUsed ? (
        <Alert>
          AI draft by {aiUsed} filled the form. Edit it so it says what <strong>you</strong> think.
          Not saved yet.
        </Alert>
      ) : null}
      <div className="s-row">
        <div className="s-field">
          <label htmlFor="t-direction">Direction</label>
          <select
            id="t-direction"
            className="s-select"
            value={f.direction}
            onChange={(e) => set("direction", e.target.value as ThesisFields["direction"])}
          >
            <option value="bullish">Bullish</option>
            <option value="neutral">Neutral</option>
            <option value="bearish">Bearish</option>
          </select>
        </div>
        <div className="s-field">
          <label htmlFor="t-horizon">Horizon (days)</label>
          <input
            id="t-horizon"
            className="s-input"
            type="number"
            min={1}
            max={3650}
            value={f.horizonDays}
            onChange={(e) =>
              set("horizonDays", Math.max(1, Math.min(3650, Number(e.target.value) || 1)))
            }
          />
        </div>
      </div>
      <div className="s-field">
        <label htmlFor="t-title">Title</label>
        <input
          id="t-title"
          className="s-input"
          value={f.title}
          onChange={(e) => set("title", e.target.value)}
          maxLength={140}
          data-testid="thesis-title"
        />
      </div>
      {area("rationale", "Rationale", "Why do you think this?")}
      {b ? (
        <div className="s-field">
          <label>Evidence from the brief (pick up to 10 cited claims)</label>
          <div className="s-stack" style={{ gap: 4, maxHeight: 260, overflowY: "auto" }}>
            {SECTIONS.flatMap(([k, label]) =>
              (b[k] as Brief["risks"]).map((c) => (
                <label key={c.id} className="s-check s-small">
                  <input
                    type="checkbox"
                    checked={f.evidence.some((e) => e.briefId === briefId && e.claimId === c.id)}
                    onChange={() => toggle(c.id)}
                  />
                  <span>
                    <span className="s-muted">{label}:</span> {c.text}
                  </span>
                </label>
              )),
            )}
          </div>
        </div>
      ) : null}
      {area("counterarguments", "Counterarguments", "The strongest case against your view")}
      {area("risks", "Risks", "What could go wrong?")}
      {area("invalidation", "What would prove you wrong", "e.g. two quarters of falling revenue")}
      {error ? (
        <Alert tone="negative">
          {error instanceof ApiRequestError ? error.message : "Could not save."}
        </Alert>
      ) : null}
      <div className="s-row">
        <Button
          variant="primary"
          disabled={!valid}
          loading={saving}
          onClick={() => onSave(f)}
          data-testid="save-thesis"
        >
          {saveLabel}
        </Button>
        <Status tone="neutral">Private until you publish</Status>
      </div>
    </Card>
  );
}
