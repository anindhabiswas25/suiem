import { Fragment, type ReactNode } from "react";

/**
 * User content is rendered as plain text (PRD §9, Sprint 6 hard rule: no HTML rendering).
 * React escapes every string. The only markup we create is <a> for http(s) URLs, with
 * rel="nofollow noopener noreferrer ugc" and target="_blank". Any other scheme (javascript:,
 * data:, vbscript:) stays text. Line breaks are preserved with CSS (white-space: pre-wrap).
 */
const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;
const TRAILING = /[.,;:!?)\]}]+$/;

export function safeHref(raw: string): string | null {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    const trail = TRAILING.exec(url)?.[0] ?? "";
    url = url.slice(0, url.length - trail.length);
    const start = m.index ?? 0;
    const href = safeHref(url);
    if (start > last) out.push(text.slice(last, start));
    out.push(
      href ? (
        <a key={start} href={href} rel="nofollow noopener noreferrer ugc" target="_blank">
          {url}
        </a>
      ) : (
        url
      ),
    );
    if (trail) out.push(trail);
    last = start + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function PlainText({ text, className }: { text: string; className?: string }) {
  return (
    <p
      className={className}
      style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", margin: 0 }}
    >
      {linkify(text).map((n, i) => (
        <Fragment key={i}>{n}</Fragment>
      ))}
    </p>
  );
}
