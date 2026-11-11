"use client";
import type { thesisResponse } from "@suiem/shared/schemas";
import { useMutation } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import type { z } from "zod";
import { PageHeader } from "../../../../components/AppShell";
import {
  EMPTY_THESIS,
  type ThesisFields,
  ThesisEditor,
} from "../../../../components/research/ThesisEditor";
import { api } from "../../../../lib/api";

function NewThesis() {
  const sp = useSearchParams();
  const router = useRouter();
  const entityId = sp.get("entityId") ?? "";
  const briefId = sp.get("briefId");
  const save = useMutation({
    mutationFn: (f: ThesisFields) =>
      api<z.infer<typeof thesisResponse>>("POST", "/theses", { ...f, entityId }),
    onSuccess: (t) => router.push(`/theses/${t.id}`),
  });
  if (!/^ent:[a-z0-9-]+$/.test(entityId))
    return <PageHeader title="New thesis">Open this from a company's research page.</PageHeader>;
  return (
    <>
      <PageHeader title="New thesis">
        Version 1 is frozen when you save, with the price at that moment. Later edits add new
        versions.
      </PageHeader>
      <ThesisEditor
        entityId={entityId}
        briefId={briefId}
        initial={EMPTY_THESIS}
        saveLabel="Save thesis"
        saving={save.isPending}
        onSave={(f) => save.mutate(f)}
        error={save.error}
      />
    </>
  );
}

export default function Page() {
  return (
    <Suspense>
      <NewThesis />
    </Suspense>
  );
}
