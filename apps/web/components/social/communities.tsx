"use client";
import { Button } from "@suiem/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";

export interface Community {
  slug: string;
  name: string;
  description: string;
  sectors: string[];
  members: number;
  joined: boolean;
}

export function useCommunities() {
  return useQuery<{ items: Community[] }>({
    queryKey: ["communities"],
    queryFn: () => api("GET", "/communities"),
  });
}

export function JoinButton({ c }: { c: Community }) {
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: () => api(c.joined ? "DELETE" : "POST", `/communities/${c.slug}/membership`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["communities"] });
      void qc.invalidateQueries({ queryKey: ["feed"] });
    },
  });
  return (
    <Button
      size="sm"
      variant={c.joined ? "secondary" : "primary"}
      loading={m.isPending}
      onClick={() => m.mutate()}
    >
      {c.joined ? "Joined" : "Join"}
    </Button>
  );
}
