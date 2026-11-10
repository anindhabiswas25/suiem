"use client";
import type { MeResponse } from "@suiem/shared/schemas";
import { useQuery } from "@tanstack/react-query";
import { api, ApiRequestError } from "./api";

/** Current user, or null when signed out. */
export function useMe() {
  return useQuery<MeResponse | null>({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api<MeResponse>("GET", "/me");
      } catch (e) {
        if (e instanceof ApiRequestError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 30_000,
  });
}
