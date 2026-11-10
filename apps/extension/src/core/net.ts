import { API_BASE } from "./config";
import { isActive } from "./state";
import { loadAuth, loadState } from "./storage";

/**
 * THE network gateway: the only module in the extension allowed to call fetch (ESLint rule).
 * It refuses every request unless the extension is ON (not paused, off or in a private session).
 * Requests never carry cookies; they authenticate with the device token only.
 */
export class NetworkBlockedError extends Error {
  constructor() {
    super("Suiem is paused, off or in private mode. Nothing was sent.");
    this.name = "NetworkBlockedError";
  }
}
export class NotConnectedError extends Error {
  constructor() {
    super("Connect the extension to your Suiem account first (Options → Account).");
    this.name = "NotConnectedError";
  }
}
export class ApiCallError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiCallError";
  }
}

export interface RequestOptions {
  /** Pairing exchange only: no token yet. */
  anonymous?: boolean;
  /** Use this token instead of the stored one (pairing confirmation step). */
  token?: string;
}

export async function apiRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: unknown,
  options: RequestOptions = {},
): Promise<T> {
  if (!isActive(await loadState(), Date.now())) throw new NetworkBlockedError();
  const headers: Record<string, string> = {};
  if (!options.anonymous) {
    const token = options.token ?? (await loadAuth())?.token;
    if (!token) throw new NotConnectedError();
    headers.authorization = `Bearer ${token}`;
  }
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    credentials: "omit",
    cache: "no-store",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : undefined;
  if (!res.ok) {
    const err = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
    throw new ApiCallError(
      res.status,
      err?.code ?? "INTERNAL",
      err?.message ?? `Request failed (${res.status})`,
    );
  }
  return json as T;
}
