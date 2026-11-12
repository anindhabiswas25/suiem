/**
 * Flags and navigation (PRD §4.1, ADR-0010). The server is the source of truth for flags and
 * jurisdiction checks; these definitions let the web app render matching navigation.
 */
export const FEATURE_FLAGS = ["trading.live", "trading.testnet", "elections", "campaigns"] as const;
export type FeatureFlag = (typeof FEATURE_FLAGS)[number];

/** Flags no API, env var or SQL update may ever enable (DB CHECK + service guard + test). */
export const HARD_OFF_FLAGS: readonly FeatureFlag[] = ["trading.live"];

export interface NavItem {
  key: string;
  label: string;
  href: string;
  /** Sprint in which the page gets real content (earlier: a proper empty state). */
  sprint: number;
  /** Network badge for pages whose actions touch a chain. */
  network?: "mainnet" | "testnet";
  /** primary: top bar · menu: avatar menu · utility: icon in the top bar. */
  group: "primary" | "menu" | "utility";
  /** Extra path prefixes that mark this item as current (pages folded into it). */
  match?: readonly string[];
}

/**
 * Main navigation, grouped as the landing page sells it: Research (free), Practice (testnet) and
 * Elections ($WIF), plus Community. Every PRD §4.1 route still exists; folded pages redirect.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "home", label: "Home", href: "/home", sprint: 2, group: "primary" },
  {
    key: "research",
    label: "Research",
    href: "/research",
    sprint: 4,
    group: "primary",
    match: ["/research", "/discover", "/theses"],
  },
  { key: "watchlist", label: "Watchlist", href: "/watchlist", sprint: 4, group: "primary" },
  {
    key: "community",
    label: "Community",
    href: "/feed",
    sprint: 6,
    group: "primary",
    match: ["/feed", "/communities", "/leaderboard", "/u/", "/posts", "/profile"],
  },
  {
    key: "elections",
    label: "Elections",
    href: "/elections",
    sprint: 7,
    network: "mainnet",
    group: "primary",
    match: ["/elections", "/campaigns"],
  },
  {
    key: "portfolio",
    label: "Practice",
    href: "/portfolio",
    sprint: 5,
    network: "testnet",
    group: "primary",
  },
  {
    key: "notifications",
    label: "Notifications",
    href: "/notifications",
    sprint: 3,
    group: "utility",
  },
  { key: "profile", label: "Profile", href: "/profile", sprint: 6, group: "menu" },
  { key: "settings", label: "Settings", href: "/settings", sprint: 2, group: "menu" },
  { key: "help", label: "Help & disclosures", href: "/help", sprint: 2, group: "menu" },
];

/** ISO-3166 alpha-2. "ZZ" means "prefer not to say" and is treated as undeclared. */
export const JURISDICTION_RE = /^[A-Z]{2}$/;
