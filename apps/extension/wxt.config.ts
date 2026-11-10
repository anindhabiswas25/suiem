import { defineConfig } from "wxt";
import key from "./extension-key.json" with { type: "json" };

/**
 * Build-time configuration (no secrets): the Suiem web origin and API base. E2E builds
 * (SUIEM_E2E=1) also grant the local fixture host so Playwright can exercise detection.
 */
const WEB_ORIGIN = process.env.SUIEM_WEB_ORIGIN ?? "http://localhost:3000";
const API_BASE = process.env.SUIEM_API_BASE ?? `${WEB_ORIGIN}/api/v1`;
const E2E = process.env.SUIEM_E2E === "1";
const E2E_HOSTS = (process.env.SUIEM_E2E_HOSTS ?? "http://127.0.0.1/*").split(",");

/** Chrome match patterns ignore ports, so drop them. */
const originPattern = (origin: string) => {
  const u = new URL(origin);
  return `${u.protocol}//${u.hostname}/*`;
};
const apiOrigin = new URL(API_BASE).origin;

export default defineConfig({
  srcDir: "src",
  outDir: E2E ? ".output-e2e" : ".output",
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Suiem Intelligence",
    short_name: "Suiem",
    description:
      "Notices companies on pages you choose and offers research when you ask. Never buys anything. Not affiliated with Robinhood Markets, Inc.",
    version: "0.3.0",
    key: key.publicKey,
    permissions: ["storage", "activeTab", "contextMenus", "sidePanel", "scripting", "alarms"],
    optional_permissions: ["notifications"],
    // Only the Suiem API is reachable. Detection sites are optional and granted one by one.
    host_permissions: [originPattern(apiOrigin), ...(E2E ? E2E_HOSTS : [])],
    optional_host_permissions: [
      "https://x.com/*",
      "https://*.x.com/*",
      "https://twitter.com/*",
      "https://*.twitter.com/*",
      "https://*/*",
    ],
    incognito: "not_allowed",
    content_security_policy: {
      extension_pages: `default-src 'self'; script-src 'self'; object-src 'self'; connect-src ${apiOrigin}; img-src 'self' data:; style-src 'self' 'unsafe-inline'`,
    },
    externally_connectable: { matches: [originPattern(WEB_ORIGIN)] },
    action: { default_title: "Suiem" },
    icons: { 16: "icon/16.png", 32: "icon/32.png", 48: "icon/48.png", 128: "icon/128.png" },
  },
  vite: () => ({
    define: {
      __SUIEM_WEB_ORIGIN__: JSON.stringify(WEB_ORIGIN),
      __SUIEM_API_BASE__: JSON.stringify(API_BASE),
      __SUIEM_E2E__: JSON.stringify(E2E),
    },
  }),
});
