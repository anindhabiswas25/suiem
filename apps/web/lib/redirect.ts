const hasControlChar = (value: string) =>
  [...value].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f);

/** Same-origin paths only: rejects absolute/protocol-relative URLs, backslashes and control chars. */
export function safeRedirect(
  next: string | null,
  origin = typeof window === "undefined" ? "http://localhost" : window.location.origin,
): string {
  if (!next || !next.startsWith("/") || next.includes("\\") || hasControlChar(next)) return "/home";
  try {
    const url = new URL(next, origin);
    // Dot segments can normalise "/.//evil" into "//evil" (protocol-relative): reject those too.
    if (url.origin !== origin || url.pathname.startsWith("//")) return "/home";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/home";
  }
}
