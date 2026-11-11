/**
 * Manual smoke check against the running dev stack (`pnpm dev`, extension built with defaults).
 * Exercises the one path the CI E2E cannot: one-click pairing from the web app over
 * externally_connectable. Usage: pnpm --filter @suiem/extension exec tsx e2e/devstack-check.ts [screenshotDir]
 */
import { chromium, expect, type Page } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import key from "../extension-key.json" with { type: "json" };

const WEB = process.env.SUIEM_WEB_ORIGIN ?? "http://localhost:3000";
const EXT = key.extensionId;
const extPath = join(import.meta.dirname, "..", ".output", "chrome-mv3");
const shots = process.argv[2];
const shot = async (page: Page, name: string) => {
  if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
};

const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "suiem-dev-")), {
  channel: "chromium",
  headless: true,
  viewport: { width: 1200, height: 900 },
  args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`],
});
try {
  if (ctx.serviceWorkers().length === 0) await ctx.waitForEvent("serviceworker");
  for (const p of ctx.pages()) if (p.url().startsWith("chrome-extension://")) await p.close();

  // Sign in through the web origin with a throwaway key (a signature, never a transaction).
  const jar = new Map<string, string>();
  const call = async (method: string, p: string, body?: unknown, csrf?: string) => {
    const r = await fetch(`${WEB}/api/v1${p}`, {
      method,
      headers: {
        cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "),
        origin: WEB,
        ...(csrf ? { "x-csrf-token": csrf } : {}),
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const [k, v] = kv!.split("=");
      jar.set(k!, v!);
    }
    return r.json();
  };
  const { csrfToken } = await call("GET", "/auth/csrf");
  const acct = privateKeyToAccount(generatePrivateKey());
  const n = await call("POST", "/auth/siwe/nonce", { chainId: 46630 }, csrfToken);
  const message = createSiweMessage({
    address: acct.address,
    chainId: 46630,
    domain: n.domain,
    uri: n.uri,
    nonce: n.nonce,
    version: "1",
    statement: n.statement,
    issuedAt: new Date(n.issuedAt),
    expirationTime: new Date(n.expirationTime),
  });
  await call(
    "POST",
    "/auth/siwe/verify",
    { message, signature: await acct.signMessage({ message }) },
    csrfToken,
  );
  for (const purpose of ["terms", "privacy"])
    await call(
      "POST",
      "/me/consents",
      { purpose, action: "granted", policyVersion: "2026-11-10.1" },
      csrfToken,
    );
  const me = await call(
    "PATCH",
    "/me",
    { jurisdiction: "IN", interestsSkipped: true, onboardingCompleted: true },
    csrfToken,
  );
  await ctx.addCookies(
    [...jar].map(([name, value]) => ({ name, value, domain: "localhost", path: "/" })),
  );

  // 1. Web Settings → Connect extension: the code goes straight to the extension.
  const web = await ctx.newPage();
  await web.goto(`${WEB}/settings`);
  await web.getByRole("button", { name: "Connect extension" }).click();
  await expect(web.getByText("Sent to your extension")).toBeVisible({ timeout: 15_000 });
  await shot(web, "web-settings-extension");

  // 2. The extension's options page has the code; the user checks the handle and confirms.
  const findOptions = () => ctx.pages().find((p) => p.url().includes(`${EXT}/options.html`));
  await expect.poll(() => !!findOptions(), { timeout: 15_000 }).toBe(true);
  const options = findOptions()!;
  await expect(options.getByTestId("pair-code")).not.toHaveValue("", { timeout: 10_000 });
  await options.getByTestId("pair-start").click();
  await expect(
    options.getByText(`This code belongs to @${me.handle}`, { exact: false }),
  ).toBeVisible();
  await shot(options, "ext-confirm-handle");
  await options.getByTestId("pair-confirm").click();
  await expect(options.getByText(`Connected as @${me.handle}`).first()).toBeVisible();

  // 3. Side panel: choose NVIDIA and add it to the watchlist.
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${EXT}/sidepanel.html`);
  await panel.getByLabel("Search companies").fill("NVDA");
  await panel.getByRole("button", { name: "Select" }).first().click();
  await expect(panel.getByTestId("entity-card")).toContainText("NVIDIA Corporation");
  await panel.getByTestId("add-watchlist").click();
  await expect(panel.getByTestId("panel-result")).toHaveText(/Added to your watchlist/);
  await shot(panel, "ext-sidepanel");
  const popup = await ctx.newPage();
  await popup.setViewportSize({ width: 360, height: 680 });
  await popup.goto(`chrome-extension://${EXT}/popup.html`);
  await shot(popup, "ext-popup");

  // 4. The web app shows the result and the connected extension.
  await web.goto(`${WEB}/watchlist`);
  await expect(web.getByText("NVIDIA")).toBeVisible();
  await shot(web, "web-watchlist");
  await web.goto(`${WEB}/settings`);
  await expect(web.getByRole("button", { name: "Revoke" })).toHaveCount(1);
  console.log(
    "DEVSTACK OK: web one-click pairing → handle confirmed → panel watchlist add → web watchlist shows NVIDIA",
  );
} finally {
  await ctx.close();
}
