import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Wordmark({ href = "/" }: { href?: string }) {
  return (
    <a className="s-wordmark" href={href} aria-label="Suiem home">
      <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2.5" />
        <path
          d="M7 14c1.5 2 3 3 5 3s3.5-1 5-3"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
      SUIEM
    </a>
  );
}

export function Button({
  variant = "secondary",
  loading = false,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
}) {
  return (
    <button
      className="s-btn"
      data-variant={variant}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="s-spinner" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}

export function Card({
  children,
  title,
  as: Tag = "section",
}: {
  children: ReactNode;
  title?: string;
  as?: "section" | "div" | "article";
}) {
  return (
    <Tag className="s-card s-stack">
      {title ? <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2> : null}
      {children}
    </Tag>
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
    mainnet: { label: "Mainnet · real $WIF", tone: "real", icon: "◆" },
    testnet: { label: "Testnet · no value", tone: "test", icon: "◇" },
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
      {retry ? <Button onClick={retry}>Try again</Button> : null}
    </div>
  );
}

export function Alert({
  children,
  tone = "warning",
}: {
  children: ReactNode;
  tone?: "warning" | "negative";
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
