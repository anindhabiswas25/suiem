import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Mark() {
  return (
    <span className="s-logo" aria-hidden="true">
      <svg viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <path
          d="M7 14c1.5 2 3 3 5 3s3.5-1 5-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export function Wordmark({ href = "/", compact = false }: { href?: string; compact?: boolean }) {
  return (
    <a className="s-wordmark" href={href} aria-label="Suiem home">
      <Mark />
      {compact ? null : <span>Suiem</span>}
    </a>
  );
}

export function Button({
  variant = "secondary",
  size,
  block,
  loading = false,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm";
  block?: boolean;
  loading?: boolean;
}) {
  // The landing's text roll, on primary buttons with plain-text labels only.
  const roll = variant === "primary" && !loading && typeof children === "string";
  return (
    <button
      className="s-btn"
      data-variant={variant}
      data-size={size}
      data-block={block || undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="s-spinner" aria-hidden="true" /> : null}
      {roll ? (
        <span className="s-roll">
          <span>{children}</span>
          <span aria-hidden="true">{children}</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}

export function Card({
  children,
  title,
  eyebrow,
  tone,
  as: Tag = "section",
}: {
  children: ReactNode;
  title?: string;
  eyebrow?: string;
  tone?: "subtle" | "dark";
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag className="s-card s-stack" data-tone={tone}>
      {eyebrow ? <span className="s-eyebrow">{eyebrow}</span> : null}
      {title ? <h2 style={{ margin: 0 }}>{title}</h2> : null}
      {children}
    </Tag>
  );
}

/** Initial-letter avatar (no uploaded images yet). */
/** Stable per-name hue so different people are easy to tell apart in a feed. */
function avatarHue(name: string): number {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % 360;
}

export function Avatar({ name, size }: { name: string; size?: "lg" }) {
  const hue = avatarHue(name.replace(/^@/, "").toLowerCase());
  return (
    <span
      className="s-avatar"
      data-size={size}
      aria-hidden="true"
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 70% 42%), hsl(${(hue + 40) % 360} 75% 64%))`,
      }}
    >
      {(name.replace(/^@/, "")[0] ?? "?").toUpperCase()}
    </span>
  );
}

const ICONS = { positive: "✓", negative: "✕", warning: "!", neutral: "•" } as const;

/** Status never relies on colour alone: always an icon plus text (PRD §20.3). */
export function Status({ tone, children }: { tone: keyof typeof ICONS; children: ReactNode }) {
  return (
    <span className="s-status" data-tone={tone}>
      <span aria-hidden="true">{ICONS[tone]}</span>
      {children}
    </span>
  );
}

/** Shown next to every onchain action (ADR-0010 §1). */
export function NetworkBadge({ network }: { network: "mainnet" | "testnet" | "offchain" }) {
  const map = {
    mainnet: { label: "Mainnet · real $WIF", tone: "real", icon: "●" },
    testnet: { label: "Testnet · no value", tone: "test", icon: "●" },
    offchain: { label: "Off-chain", tone: "neutral", icon: "○" },
  } as const;
  const m = map[network];
  return (
    <span className="s-badge" data-tone={m.tone} title={m.label}>
      <span aria-hidden="true">{m.icon}</span>
      {m.label}
    </span>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="s-state" role="status" aria-live="polite">
      <span className="s-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="s-state">
      <h3>{title}</h3>
      {children ? <div className="s-muted">{children}</div> : null}
      {action}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  message,
  retry,
}: {
  title?: string;
  message?: string;
  retry?: () => void;
}) {
  return (
    <div className="s-state" role="alert">
      <Status tone="negative">{title}</Status>
      {message ? <div className="s-muted">{message}</div> : null}
      {retry ? (
        <Button size="sm" onClick={retry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

export function Alert({
  children,
  tone = "warning",
}: {
  children: ReactNode;
  tone?: "warning" | "negative" | "info";
}) {
  return (
    <div className="s-alert" data-tone={tone} role="note">
      {children}
    </div>
  );
}

export function Steps({
  total,
  current,
  label,
}: {
  total: number;
  current: number;
  label: string;
}) {
  return (
    <ol className="s-steps" aria-label={`${label}: step ${current + 1} of ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <li key={i} data-done={i <= current} />
      ))}
    </ol>
  );
}

export const DISCLAIMER = "Suiem is not affiliated with Robinhood Markets, Inc.";
