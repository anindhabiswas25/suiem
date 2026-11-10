"use client";
import type { ErrorEnvelope } from "@suiem/shared/errors";

/** Thrown for any non-2xx API response; carries the structured error envelope. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

let csrfToken: string | null = null;

async function ensureCsrf(): Promise<string> {
  if (csrfToken) return csrfToken;
  const r = await fetch("/api/v1/auth/csrf", { credentials: "same-origin" });
  csrfToken = ((await r.json()) as { csrfToken: string }).csrfToken;
  return csrfToken;
}

/** Same-origin JSON client. Writes carry the double-submit CSRF token (the API also checks Origin). */
export async function api<T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET") headers["x-csrf-token"] = await ensureCsrf();
  if (body !== undefined) headers["content-type"] = "application/json";
  const r = await fetch(`/api/v1${path}`, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;
  if (!r.ok) {
    const env = json as ErrorEnvelope | undefined;
    if (env?.error.code === "CSRF_FAILED") csrfToken = null;
    throw new ApiRequestError(
      r.status,
      env?.error.code ?? "INTERNAL",
      env?.error.message ?? `Request failed (${r.status})`,
    );
  }
  return json as T;
}
