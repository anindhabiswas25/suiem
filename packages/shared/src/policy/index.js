/**
 * Capabilities, flags and navigation (PRD §4.1, §17, ADR-0001 §5). The server's policy engine is
 * the source of truth. These definitions let the web app render a nav that matches server decisions.
 */
export const FEATURE_FLAGS = ["trading.live", "trading.simulated", "elections", "campaigns"];
/** Flags no API, admin action or SQL update may ever enable (DB CHECK + service guard). */
export const HARD_OFF_FLAGS = ["trading.live"];
export const CAPABILITIES = [
  "research",
  "education",
  "social",
  "simulated_trading",
  "live_trading",
  "elections",
  "campaigns",
];
/** Capability → flag that must also be on (if any). */
export const CAPABILITY_FLAG = {
  simulated_trading: "trading.simulated",
  live_trading: "trading.live",
  elections: "elections",
  campaigns: "campaigns",
};
/** PRD §4.1 main navigation. */
export const NAV_ITEMS = [
  { key: "home", label: "Home", href: "/home", capability: "research", phase: 2 },
  { key: "discover", label: "Discover", href: "/discover", capability: "research", phase: 3 },
  { key: "research", label: "Research", href: "/research", capability: "research", phase: 3 },
  { key: "watchlist", label: "Watchlist", href: "/watchlist", capability: "research", phase: 4 },
  {
    key: "portfolio",
    label: "Portfolio",
    href: "/portfolio",
    capability: "simulated_trading",
    phase: 4,
  },
  { key: "feed", label: "Social Feed", href: "/feed", capability: "social", phase: 5 },
  {
    key: "communities",
    label: "Communities",
    href: "/communities",
    capability: "social",
    phase: 5,
  },
  {
    key: "leaderboard",
    label: "Leaderboard",
    href: "/leaderboard",
    capability: "social",
    phase: 6,
  },
  { key: "elections", label: "Elections", href: "/elections", capability: "elections", phase: 7 },
  { key: "campaigns", label: "Campaigns", href: "/campaigns", capability: "campaigns", phase: 7 },
  { key: "settings", label: "Settings", href: "/settings", capability: "education", phase: 2 },
  { key: "help", label: "Help and disclosures", href: "/help", capability: "education", phase: 2 },
];
/** ISO-3166 alpha-2 country codes plus "ZZ" (not declared). */
export const JURISDICTION_RE = /^[A-Z]{2}$/;
