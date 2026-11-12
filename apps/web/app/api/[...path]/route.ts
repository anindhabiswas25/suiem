/**
 * Same-origin API proxy: the browser only talks to the web origin, so session cookies stay
 * first-party. Runs server-side (Node), forwarding method, headers, body and every Set-Cookie
 * to API_URL. Used instead of an edge rewrite so the upstream host is resolved by the function.
 */
export const dynamic = "force-dynamic";

const API_URL = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");

// Hop-by-hop or recomputed headers are never forwarded.
const DROP_REQUEST = new Set([
  "host",
  "connection",
  "content-length",
  "accept-encoding",
  "transfer-encoding",
  // Client-supplied forwarding headers are never trusted; the client IP is set below.
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
  "x-forwarded-port",
  "x-real-ip",
  "forwarded",
  "x-suiem-proxy",
]);
const DROP_RESPONSE = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "set-cookie",
]);

async function proxy(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = `${API_URL}${url.pathname}${url.search}`;
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (!DROP_REQUEST.has(key.toLowerCase())) headers.set(key, value);
  });
  // Vercel overwrites x-real-ip / x-forwarded-for with the real client address, so these are
  // platform-provided, not client-controlled.
  const clientIp =
    request.headers.get("x-real-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "";
  if (clientIp) headers.set("x-forwarded-for", clientIp);
  const secret = process.env.API_PROXY_SECRET;
  if (secret) headers.set("x-suiem-proxy", secret);
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: hasBody ? await request.arrayBuffer() : undefined,
    redirect: "manual",
    cache: "no-store",
  });
  const out = new Headers();
  upstream.headers.forEach((value, key) => {
    if (!DROP_RESPONSE.has(key.toLowerCase())) out.set(key, value);
  });
  for (const cookie of upstream.headers.getSetCookie()) out.append("set-cookie", cookie);
  return new Response(upstream.status === 204 || upstream.status === 304 ? null : upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: out,
  });
}

export const GET = proxy;
export const HEAD = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const OPTIONS = proxy;
