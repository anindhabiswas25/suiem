import {
  type BrowserContext,
  chromium,
  expect,
  type Page,
  test,
  type Worker,
} from "@playwright/test";
import { mkdtempSync } from "node:fs";
import pg from "pg";
import { newId } from "../../../packages/shared/src/ids";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import type { LoggedRequest } from "./global-setup";

const API = process.env.E2E_API_URL!;
const PROXY = process.env.E2E_PROXY_URL!;
const FIX = process.env.E2E_FIXTURE_URL!;
const EXT_ID = process.env.E2E_EXT_ID!;
const ext = (p: string) => `chrome-extension://${EXT_ID}/${p}`;
const WEB = "http://localhost:3000";

let ctx: BrowserContext;
let sw: Worker;
let user: WebSession;

// ---- helpers ------------------------------------------------------------------------------

/** A signed-in web session talking to the API directly (not through the extension's proxy). */
class WebSession {
  private jar = new Map<string, string>();
  private csrf = "";
  async call(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = {
      cookie: [...this.jar].map(([k, v]) => `${k}=${v}`).join("; "),
      origin: WEB,
    };
    if (method !== "GET") headers["x-csrf-token"] = this.csrf;
    if (body !== undefined) headers["content-type"] = "application/json";
    const r = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const [k, v] = kv!.split("=");
      this.jar.set(k!, v!);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON access keeps tests readable
    return { status: r.status, json: (await r.json().catch(() => null)) as Record<string, any> };
  }
  async login() {
    this.csrf = (await this.call("GET", "/auth/csrf")).json.csrfToken;
    const account = privateKeyToAccount(generatePrivateKey());
    const n = (await this.call("POST", "/auth/siwe/nonce", { chainId: 46630 })).json;
    const message = createSiweMessage({
      address: account.address,
      chainId: 46630,
      domain: n.domain,
      uri: n.uri,
      nonce: n.nonce,
      version: "1",
      statement: n.statement,
      issuedAt: new Date(n.issuedAt),
      expirationTime: new Date(n.expirationTime),
    });
    const r = await this.call("POST", "/auth/siwe/verify", {
      message,
      signature: await account.signMessage({ message }),
    });
    expect(r.status).toBe(200);
    return this;
  }
}

const proxyLog = async (): Promise<LoggedRequest[]> => (await fetch(`${PROXY}/__log`)).json();
const resetProxy = () => fetch(`${PROXY}/__reset`);
const registered = () => sw.evaluate(() => chrome.scripting.getRegisteredContentScripts());
const alarms = () => sw.evaluate(() => chrome.alarms.getAll());
const digest = () =>
  sw.evaluate(
    async () =>
      ((await chrome.storage.local.get("digest")).digest ?? []) as {
        kind: string;
        entityName: string;
      }[],
  );

/** Sends a message to the worker from an extension page (like the popup/options do). */
async function toWorker(msg: unknown) {
  const page = await ctx.newPage();
  await page.goto(ext("popup.html"));
  const r = await page.evaluate((m) => chrome.runtime.sendMessage(m), msg);
  await page.close();
  return r;
}

/** Opens a fixture page while counting extension content-script executions via CDP. */
async function openCounted(path: string) {
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  let contentScriptRuns = 0;
  cdp.on(
    "Runtime.executionContextCreated",
    (e: { context: { origin?: string; name?: string; auxData?: { type?: string } } }) => {
      if (
        e.context.auxData?.type === "isolated" &&
        (e.context.origin?.includes(EXT_ID) || e.context.name === "Suiem Intelligence")
      )
        contentScriptRuns += 1;
    },
  );
  await cdp.send("Runtime.enable");
  await page.goto(`${FIX}/${path}`);
  return { page, runs: () => contentScriptRuns };
}

const toast = (page: Page) => page.locator("suiem-toast");

/** Scripted browsing: scroll, wait for detection debounce, scroll again. */
async function browse(page: Page) {
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(1500);
  await page.mouse.wheel(0, -400);
  await page.waitForTimeout(1500);
}

// ---- setup --------------------------------------------------------------------------------

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "suiem-e2e-"));
  const path = process.env.E2E_EXT_PATH!;
  ctx = await chromium.launchPersistentContext(dir, {
    channel: "chromium",
    headless: true,
    args: [`--disable-extensions-except=${path}`, `--load-extension=${path}`],
  });
  sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  expect(sw.url()).toBe(ext("background.js"));
  // The install flow opens the options page; close it to start from a clean slate.
  for (const p of ctx.pages()) if (p.url().startsWith(ext(""))) await p.close();
  user = await new WebSession().login();
});

test.afterAll(async () => {
  await ctx?.close();
});

test("0. connect to a Suiem account (pairing with handle confirmation) and grant a site", async () => {
  const code = (await user.call("POST", "/extension/pairing-codes", {})).json.code as string;
  const me = (await user.call("GET", "/me")).json;
  const options = await ctx.newPage();
  await options.goto(ext("options.html"));
  await expect(
    options.getByText("Suiem is not affiliated with Robinhood Markets, Inc.", { exact: false }),
  ).toBeVisible();
  await options.getByTestId("pair-code").fill(code);
  await options.getByTestId("pair-start").click();
  // The extension shows the account handle and only stores the token after confirmation.
  await expect(
    options.getByText(`This code belongs to @${me.handle}`, { exact: false }),
  ).toBeVisible();
  await options.getByTestId("pair-confirm").click();
  await expect(options.getByText(`Connected as @${me.handle}`).first()).toBeVisible();

  await options.getByLabel("Site to add").fill("localhost");
  await options.getByRole("button", { name: "Add site" }).click();
  await expect(
    options.getByRole("list", { name: "Granted sites" }).getByText("localhost"),
  ).toBeVisible();
  await expect.poll(async () => (await registered()).map((r) => r.id)).toEqual(["suiem-detector"]);

  // Enable the local digest so an alarm exists (it must disappear when OFF/PAUSED).
  await options.getByRole("checkbox", { name: /daily digest/ }).click();
  await expect.poll(async () => (await alarms()).map((a) => a.name)).toEqual(["suiem.digest"]);
  await options.close();
  // The token is not in chrome.storage.local (content scripts can read that area).
  expect(
    await sw.evaluate(async () => (await chrome.storage.local.get(null)).auth),
  ).toBeUndefined();
});

test("1. detection ON: $NVDA shows exactly one notification, not again within the window", async () => {
  await resetProxy();
  const { page } = await openCounted("nvda.html");
  await expect(toast(page).getByText("NVIDIA detected")).toBeVisible({ timeout: 10_000 });
  await browse(page);
  await expect(toast(page)).toHaveCount(1);
  // Detection is local: nothing was sent to Suiem.
  expect(await proxyLog()).toEqual([]);
  // Dismiss records no intent and sends nothing.
  const before = (await digest()).length;
  await toast(page).getByRole("button", { name: "Dismiss" }).click();
  await expect(toast(page)).toHaveCount(0);
  expect((await digest()).length).toBe(before);

  await page.reload();
  await browse(page);
  await expect(toast(page)).toHaveCount(0);
  const again = await openCounted("nvda-again.html");
  await browse(again.page);
  await expect(toast(again.page)).toHaveCount(0);
  expect(await proxyLog()).toEqual([]);
  await page.close();
  await again.page.close();
});

test("2. an 'Apple pie' page shows no notification", async () => {
  const { page, runs } = await openCounted("apple-pie.html");
  await browse(page);
  expect(runs()).toBeGreaterThan(0); // the detector did run here…
  await expect(toast(page)).toHaveCount(0); // …and stayed silent
  await page.close();
});

for (const mode of ["OFF", "PAUSED"] as const) {
  test(`3. ${mode}: zero content-script executions, zero registered scripts, zero network, zero alarms`, async () => {
    await toWorker(
      mode === "OFF"
        ? { type: "event", event: { type: "turnOff" } }
        : { type: "event", event: { type: "pause", choice: { kind: "minutes", minutes: 30 } } },
    );
    expect(await registered()).toEqual([]);
    expect(await alarms()).toEqual([]);
    await resetProxy();
    for (const path of ["tesla.html", "palantir.html"]) {
      const { page, runs } = await openCounted(path);
      await browse(page);
      expect(runs(), path).toBe(0);
      await expect(toast(page)).toHaveCount(0);
      await page.close();
    }
    // Extension pages also send nothing while inactive.
    const panel = await ctx.newPage();
    await panel.goto(ext("sidepanel.html"));
    await expect(panel.getByText(/Nothing will be sent until you turn it back on/)).toBeVisible();
    await panel.close();
    expect(await proxyLog()).toEqual([]);
    expect(await registered()).toEqual([]);
    expect(await alarms()).toEqual([]);
    await toWorker({ type: "event", event: { type: "turnOn" } });
    await expect.poll(async () => (await registered()).length).toBe(1);
    await expect.poll(async () => (await alarms()).length).toBe(1);
  });
}

test("4. PRIVATE site: no detection and no digest entry", async () => {
  const before = await digest();
  await toWorker({ type: "event", event: { type: "privateSite", host: "localhost", on: true } });
  expect(await registered()).toEqual([]);
  const { page, runs } = await openCounted("netflix.html");
  await browse(page);
  expect(runs()).toBe(0);
  await expect(toast(page)).toHaveCount(0);
  expect(await digest()).toEqual(before);
  await page.close();
  await toWorker({ type: "event", event: { type: "privateSite", host: "localhost", on: false } });
  await expect.poll(async () => (await registered()).length).toBe(1);
});

test("5. highlighting sends nothing; research sends only the previewed fields after confirmation", async () => {
  // Highlight text on a page with a detectable company: no request is made.
  const amd = await openCounted("amd.html");
  await expect(toast(amd.page).getByText("AMD detected")).toBeVisible({ timeout: 10_000 });
  await resetProxy();
  await amd.page.locator("#post-text").selectText();
  await amd.page.mouse.up();
  await amd.page.waitForTimeout(2000);
  expect(await proxyLog()).toEqual([]);
  await amd.page.close();

  // Research flow from a notification. The page URL carries a query string that must NOT be sent.
  const { page } = await openCounted("palantir.html?utm_source=private-campaign&uid=42");
  await expect(toast(page).getByText("Palantir detected")).toBeVisible({ timeout: 10_000 });
  await toast(page).getByRole("button", { name: "Research" }).click();
  const tabId = await expect
    .poll(async () => {
      const all = (await sw.evaluate(() => chrome.storage.session.get(null))) as Record<
        string,
        { entityId?: string }
      >;
      return Object.entries(all).find(
        ([k, v]) => k.startsWith("panel:") && v.entityId === "ent:palantir",
      )?.[0];
    })
    .toBeTruthy()
    .then(async () => {
      const all = (await sw.evaluate(() => chrome.storage.session.get(null))) as Record<
        string,
        { entityId?: string }
      >;
      return Object.entries(all)
        .find(([k, v]) => k.startsWith("panel:") && v.entityId === "ent:palantir")![0]
        .slice(6);
    });

  const panel = await ctx.newPage();
  await panel.goto(ext(`sidepanel.html?tab=${tabId}`));
  await expect(panel.getByTestId("entity-card")).toContainText("Palantir Technologies Inc.");
  await expect(panel.getByText("TEST:PLTR")).toBeVisible(); // instruments from the real API
  await expect(panel.getByText(/Testnet · no value/).first()).toBeVisible();
  // Opening the panel (ON, connected) checks this company's research status once; wait for it.
  await expect
    .poll(async () =>
      (await proxyLog()).some((r) => r.path.startsWith("/api/v1/research/requests")),
    )
    .toBe(true);
  await resetProxy();
  await panel.getByTestId("request-research").click();
  const preview = JSON.parse((await panel.getByTestId("research-preview").textContent()) ?? "{}");
  expect(preview).toEqual({
    entityId: "ent:palantir",
    sourceUrl: `${FIX}/palantir.html`,
    userConfirmed: true,
  });
  expect(await proxyLog()).toEqual([]); // previewing sends nothing
  await panel.getByTestId("confirm-research").click();
  await expect(panel.getByTestId("panel-result")).toHaveText(/Queued/);
  const sent = (await proxyLog()).filter((r) => r.path === "/api/v1/extension/research-context");
  expect(sent).toHaveLength(1);
  expect(sent[0]!.body).toEqual(preview);
  expect(sent[0]).toMatchObject({
    method: "POST",
    hasAuth: true,
    hasCookie: false,
    origin: `chrome-extension://${EXT_ID}`,
  });

  // The panel polls the request while it is pending; when the brief completes it shows the
  // summary, top risks and a link to the full brief (simulated completion: no AI in E2E).
  await expect(panel.getByTestId("brief-status")).toHaveText(/Researching/);
  const db = new pg.Client({ connectionString: process.env.E2E_PG_URL });
  await db.connect();
  await db.query(
    `WITH r AS (SELECT id, user_id, entity_id FROM research_requests WHERE source_url = $1 ORDER BY created_at DESC LIMIT 1),
          b AS (INSERT INTO research_briefs (id, user_id, entity_id, schema_version, brief, model, provider, prompt_version, data_freshness)
                SELECT $3::uuid, user_id, entity_id, 'brief.v1', $2::jsonb, 'test-model', 'groq', 'research.v1', 'fresh' FROM r RETURNING id)
     UPDATE research_requests SET status = 'completed', brief_id = (SELECT id FROM b) WHERE id = (SELECT id FROM r)`,
    [
      `${FIX}/palantir.html`,
      JSON.stringify({
        summary: "Palantir sells data analytics software.",
        risks: [{ text: "Government contract concentration." }],
      }),
      newId(),
    ],
  );
  await db.end();
  await expect(panel.getByTestId("brief-summary")).toHaveText(
    "Palantir sells data analytics software.",
    { timeout: 15_000 },
  );
  await expect(panel.getByTestId("brief-ready")).toContainText(
    "Government contract concentration.",
  );
  await expect(panel.getByTestId("full-brief")).toHaveAttribute(
    "href",
    /\/research\/ent%3Apalantir$/,
  );
  await expect(panel.getByText(/\bbuy\b/i)).toHaveCount(0); // still no buy action in the extension

  await panel.getByTestId("add-watchlist").click();
  await expect(panel.getByTestId("panel-result")).toHaveText(/Added to your watchlist/);
  // End to end: the web account now has the request and the watchlist item.
  expect(
    (await user.call("GET", "/research/requests?entityId=ent:palantir")).json.items,
  ).toHaveLength(1);
  expect(
    (await user.call("GET", "/watchlists/default")).json.items.map((i: { name: string }) => i.name),
  ).toEqual(["Palantir"]);
  await panel.close();
  await page.close();
});

test("6. removing a site's permission stops detection immediately", async () => {
  const options = await ctx.newPage();
  await options.goto(ext("options.html"));
  await options
    .getByRole("list", { name: "Granted sites" })
    .getByRole("button", { name: "Remove" })
    .click();
  await expect(options.getByText("No sites yet.")).toBeVisible();
  expect(await registered()).toEqual([]);
  const { page, runs } = await openCounted("tesla.html");
  await browse(page);
  expect(runs()).toBe(0);
  await expect(toast(page)).toHaveCount(0);
  await page.close();
  await options.close();
});

test("7. the digest shows only intentional actions; delete all empties it", async () => {
  const items = await digest();
  expect(new Set(items.map((i) => i.kind))).toEqual(
    new Set(["acknowledged", "panel_opened", "research_requested", "watchlist_added"]),
  );
  expect(new Set(items.map((i) => i.entityName))).toEqual(new Set(["Palantir"]));
  const options = await ctx.newPage();
  await options.goto(ext("options.html"));
  await expect(options.getByTestId("digest-item")).toHaveCount(4);
  await options.getByTestId("delete-all").click();
  await expect(options.getByText("Your digest is empty")).toBeVisible();
  expect(await digest()).toEqual([]);
  await options.close();
});

test("8. revoking the extension in web Settings takes effect immediately", async () => {
  const installs = (await user.call("GET", "/extension/installations")).json.items as {
    id: string;
  }[];
  expect(installs).toHaveLength(1);
  expect((await user.call("DELETE", `/extension/installations/${installs[0]!.id}`)).status).toBe(
    200,
  );
  const panel = await ctx.newPage();
  await panel.goto(ext("sidepanel.html"));
  await panel.getByLabel("Search companies").fill("NVDA");
  await panel.getByRole("button", { name: "Select" }).first().click();
  await expect(panel.getByText(/invalid or revoked/)).toBeVisible();
  await panel.close();
});
