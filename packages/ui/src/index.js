import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
export function Wordmark({ href = "/" }) {
  return _jsxs("a", {
    className: "s-wordmark",
    href: href,
    "aria-label": "Suiem home",
    children: [
      _jsxs("svg", {
        width: "22",
        height: "22",
        viewBox: "0 0 24 24",
        "aria-hidden": "true",
        children: [
          _jsx("circle", {
            cx: "12",
            cy: "12",
            r: "10",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: "2.5",
          }),
          _jsx("path", {
            d: "M7 14c1.5 2 3 3 5 3s3.5-1 5-3",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: "2.5",
            strokeLinecap: "round",
          }),
        ],
      }),
      "SUIEM",
    ],
  });
}
export function Button({ variant = "secondary", loading = false, children, disabled, ...rest }) {
  return _jsxs("button", {
    className: "s-btn",
    "data-variant": variant,
    disabled: disabled || loading,
    "aria-busy": loading || undefined,
    ...rest,
    children: [
      loading ? _jsx("span", { className: "s-spinner", "aria-hidden": "true" }) : null,
      children,
    ],
  });
}
export function Card({ children, title, as: Tag = "section" }) {
  return _jsxs(Tag, {
    className: "s-card s-stack",
    children: [
      title ? _jsx("h2", { style: { margin: 0, fontSize: 18 }, children: title }) : null,
      children,
    ],
  });
}
const ICONS = { positive: "✓", negative: "✕", warning: "!", neutral: "•" };
/** Status never relies on colour alone: always an icon plus text (PRD §20.3). */
export function Status({ tone, children }) {
  return _jsxs("span", {
    className: "s-status",
    "data-tone": tone,
    children: [_jsx("span", { "aria-hidden": "true", children: ICONS[tone] }), children],
  });
}
/** Shown next to every onchain action (ADR-0010 §1). */
export function NetworkBadge({ network }) {
  const map = {
    mainnet: { label: "Mainnet · real $WIF", tone: "real", icon: "◆" },
    testnet: { label: "Testnet · no value", tone: "test", icon: "◇" },
    offchain: { label: "Off-chain", tone: "neutral", icon: "○" },
  };
  const m = map[network];
  return _jsxs("span", {
    className: "s-badge",
    "data-tone": m.tone,
    title: m.label,
    children: [_jsx("span", { "aria-hidden": "true", children: m.icon }), m.label],
  });
}
export function LoadingState({ label = "Loading…" }) {
  return _jsxs("div", {
    className: "s-state",
    role: "status",
    "aria-live": "polite",
    children: [
      _jsx("span", { className: "s-spinner", "aria-hidden": "true" }),
      _jsx("span", { children: label }),
    ],
  });
}
export function EmptyState({ title, children, action }) {
  return _jsxs("div", {
    className: "s-state",
    children: [
      _jsx("h3", { children: title }),
      children ? _jsx("div", { className: "s-muted", children: children }) : null,
      action,
    ],
  });
}
export function ErrorState({ title = "Something went wrong", message, retry }) {
  return _jsxs("div", {
    className: "s-state",
    role: "alert",
    children: [
      _jsx(Status, { tone: "negative", children: title }),
      message ? _jsx("div", { className: "s-muted", children: message }) : null,
      retry ? _jsx(Button, { onClick: retry, children: "Try again" }) : null,
    ],
  });
}
export function Alert({ children, tone = "warning" }) {
  return _jsx("div", { className: "s-alert", "data-tone": tone, role: "note", children: children });
}
export function Steps({ total, current, label }) {
  return _jsx("ol", {
    className: "s-steps",
    "aria-label": `${label}: step ${current + 1} of ${total}`,
    children: Array.from({ length: total }, (_, i) => _jsx("li", { "data-done": i <= current }, i)),
  });
}
export const DISCLAIMER = "Suiem is not affiliated with Robinhood Markets, Inc.";
