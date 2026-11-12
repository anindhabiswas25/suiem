"use client";
import type { quoteResponse, thesisListResponse, watchlistsResponse } from "@suiem/shared/schemas";
import { Alert, Button, Card, EmptyState, ErrorState, LoadingState } from "@suiem/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import type { z } from "zod";
import type { PostView } from "@suiem/shared/social";
import { PageHeader, TabLinks } from "../../../components/AppShell";
import { PostCard } from "../../../components/social/Post";
import { EntitySearch } from "../../../components/research/ui";
import { api, ApiRequestError } from "../../../lib/api";

type Lists = z.infer<typeof watchlistsResponse>;
type Item = Lists["items"][number]["items"][number];
type Theses = z.infer<typeof thesisListResponse>;

function WatchlistsView() {
  const qc = useQueryClient();
  const lists = useQuery<Lists>({
    queryKey: ["watchlists"],
    queryFn: () => api("GET", "/watchlists"),
  });
  const theses = useQuery<Theses>({ queryKey: ["theses"], queryFn: () => api("GET", "/theses") });
  const [name, setName] = useState("");
  const create = useMutation({
    mutationFn: () => api("POST", "/watchlists", { name }),
    onSuccess: () => {
      setName("");
      void qc.invalidateQueries({ queryKey: ["watchlists"] });
    },
  });
  return (
    <>
      {lists.isPending ? <LoadingState /> : null}
      {lists.isError ? (
        <ErrorState message="Could not load your watchlists." retry={() => void lists.refetch()} />
      ) : null}
      {lists.data && lists.data.items.length === 0 ? (
        <EmptyState title="No watchlists yet">
          Create one below, or add a company from a research page or the extension.
        </EmptyState>
      ) : null}
      {lists.data?.items.map((l) => (
        <Card key={l.id} title={l.name}>
          <AddToList listId={l.id} />
          {l.items.length === 0 ? <span className="s-muted s-small">Empty.</span> : null}
          <ul className="s-stack" style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {l.items.map((i) => (
              <WatchItem
                key={i.id}
                listId={l.id}
                item={i}
                theses={(theses.data?.items ?? []).filter((t) => t.entityId === i.entityId)}
              />
            ))}
          </ul>
        </Card>
      ))}
      <Card title="New watchlist">
        <form
          className="s-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
        >
          <input
            className="s-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="e.g. Semiconductors"
            aria-label="Watchlist name"
          />
          <Button type="submit" loading={create.isPending}>
            Create
          </Button>
        </form>
        {create.isError ? (
          <Alert tone="negative">
            {create.error instanceof ApiRequestError
              ? create.error.message
              : "Could not create the list."}
          </Alert>
        ) : null}
      </Card>
    </>
  );
}

function AddToList({ listId }: { listId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const add = useMutation({
    mutationFn: (entityId: string) => api("POST", `/watchlists/${listId}/items`, { entityId }),
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["watchlists"] });
    },
  });
  return open ? (
    <EntitySearch onPick={(id) => add.mutate(id)} placeholder="Add a company" />
  ) : (
    <Button variant="ghost" onClick={() => setOpen(true)}>
      + Add company
    </Button>
  );
}

function WatchItem({
  listId,
  item,
  theses,
}: {
  listId: string;
  item: Item;
  theses: Theses["items"];
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState(item.note ?? "");
  const quote = useQuery<z.infer<typeof quoteResponse>>({
    queryKey: ["quote", item.entityId],
    queryFn: () => api("GET", `/entities/${encodeURIComponent(item.entityId)}/quote`),
    enabled: !!item.ticker,
    retry: false,
    staleTime: 60_000,
  });
  const invalidate = () => void qc.invalidateQueries({ queryKey: ["watchlists"] });
  const patch = useMutation({
    mutationFn: (body: { note?: string | null; thesisId?: string | null }) =>
      api("PATCH", `/watchlists/${listId}/items/${item.id}`, body),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => api("DELETE", `/watchlists/${listId}/items/${item.id}`),
    onSuccess: invalidate,
  });
  const linked = theses.find((t) => t.id === item.thesisId);
  return (
    <li
      className="s-stack"
      style={{ gap: 4, borderBottom: "1px solid rgba(127,127,127,.2)", paddingBottom: 8 }}
      data-testid="watch-item"
    >
      <div className="s-row">
        <Link href={`/research/${encodeURIComponent(item.entityId)}`}>
          <strong>{item.name}</strong>
        </Link>
        {item.ticker ? <span className="s-muted">{item.ticker}</span> : null}
        {quote.data ? (
          <span className="s-small">
            USD {quote.data.price} ({quote.data.changePercent ?? "—"}%) ·{" "}
            {new Date(quote.data.asOf).toLocaleString()} · {quote.data.source}
          </span>
        ) : null}
        <Button variant="ghost" onClick={() => remove.mutate()} loading={remove.isPending}>
          Remove
        </Button>
      </div>
      <div className="s-row">
        <input
          className="s-input"
          style={{ flex: 1 }}
          value={note}
          maxLength={500}
          placeholder="Note"
          onChange={(e) => setNote(e.target.value)}
          aria-label={`Note for ${item.name}`}
        />
        <Button
          onClick={() => patch.mutate({ note: note.trim() || null })}
          loading={patch.isPending}
          disabled={(item.note ?? "") === note}
        >
          Save note
        </Button>
      </div>
      <div className="s-row s-small">
        Thesis:{" "}
        {linked ? (
          <Link href={`/theses/${linked.id}`}>{linked.title}</Link>
        ) : (
          <span className="s-muted">none linked</span>
        )}
        {theses.length ? (
          <select
            className="s-select"
            value={item.thesisId ?? ""}
            onChange={(e) => patch.mutate({ thesisId: e.target.value || null })}
            aria-label="Link a thesis"
          >
            <option value="">No thesis</option>
            {theses.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        ) : (
          <Link href={`/theses/new?entityId=${encodeURIComponent(item.entityId)}`}>Write one</Link>
        )}
      </div>
    </li>
  );
}

function Saved() {
  const q = useQuery<{ items: PostView[] }>({
    queryKey: ["bookmarks"],
    queryFn: () => api("GET", "/bookmarks"),
  });
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState message={q.error.message} retry={() => void q.refetch()} />;
  if (!q.data.items.length)
    return (
      <EmptyState title="Nothing saved yet">
        Press Save on any post in Community to keep it here.
      </EmptyState>
    );
  return (
    <div className="s-stack" style={{ gap: 14, maxWidth: 760 }}>
      {q.data.items.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
    </div>
  );
}

function Watchlist() {
  const sp = useSearchParams();
  const tab = sp.get("tab") === "saved" ? "saved" : "lists";
  return (
    <>
      <PageHeader title="Watchlist" eyebrow="Companies you follow">
        Companies you&apos;re following, with your notes and theses. Adding a company never buys
        anything.
      </PageHeader>
      <TabLinks
        label="Watchlist"
        current={tab}
        tabs={[
          { key: "lists", label: "Watchlists", href: "/watchlist" },
          { key: "saved", label: "Saved posts", href: "/watchlist?tab=saved" },
        ]}
      />
      {tab === "saved" ? <Saved /> : <WatchlistsView />}
    </>
  );
}

export default function WatchlistPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <Watchlist />
    </Suspense>
  );
}
