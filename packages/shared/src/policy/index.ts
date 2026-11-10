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
}

/** PRD §4.1 main navigation. Every route exists from Sprint 2. */
export const NAV_ITEMS: readonly NavItem[] = [
  { key: "home", label: "Home", href: "/home", sprint: 2 },
  { key: "discover", label: "Discover", href: "/discover", sprint: 4 },
  { key: "research", label: "Research", href: "/research", sprint: 4 },
  { key: "watchlist", label: "Watchlist", href: "/watchlist", sprint: 4 },
  { key: "portfolio", label: "Portfolio", href: "/portfolio", sprint: 5, network: "testnet" },
  { key: "feed", label: "Feed", href: "/feed", sprint: 6 },
  { key: "communities", label: "Communities", href: "/communities", sprint: 6 },
  { key: "leaderboard", label: "Leaderboard", href: "/leaderboard", sprint: 6 },
  { key: "elections", label: "Elections", href: "/elections", sprint: 7, network: "mainnet" },
  { key: "campaigns", label: "Campaigns", href: "/campaigns", sprint: 7, network: "mainnet" },
  { key: "profile", label: "Profile", href: "/profile", sprint: 6 },
  { key: "notifications", label: "Notifications", href: "/notifications", sprint: 3 },
  { key: "settings", label: "Settings", href: "/settings", sprint: 2 },
  { key: "help", label: "Help & disclosures", href: "/help", sprint: 2 },
];

/** ISO-3166 alpha-2. "ZZ" means "prefer not to say" and is treated as undeclared. */
export const JURISDICTION_RE = /^[A-Z]{2}$/;
