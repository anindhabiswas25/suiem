import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer } from "@testcontainers/redis";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer, request, type IncomingMessage, type Server } from "node:http";
import { type AddressInfo, createServer as netServer } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WIF } from "@suiem/config/chains";
import pg from "pg";
import { migrate } from "../../../packages/db/src/migrate";
import { seed } from "../../../packages/db/src/seed";
import key from "../extension-key.json" with { type: "json" };
import { FIXTURES } from "./fixtures";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const EXT_DIR = join(import.meta.dirname, "..");

const freePort = () =>
  new Promise<number>((resolve) => {
    const s = netServer().listen(0, "127.0.0.1", () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => resolve(p));
    });
  });

async function waitFor(url: string, tries = 150) {
  for (let i = 0; i < tries; i++) {
    const ok = await fetch(url)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out waiting for ${url}`);
}

const readBody = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
  });

export interface LoggedRequest {
  method: string;
  path: string;
  origin: string | null;
  hasAuth: boolean;
  hasCookie: boolean;
  body: unknown;
  at: number;
}

export default async function globalSetup() {
  const children: ChildProcess[] = [];
  const servers: Server[] = [];

  // 1. Database + cache
  const [pgc, redis] = await Promise.all([
    new PostgreSqlContainer("postgres:16.11-alpine")
      .withDatabase("suiem")
      .withUsername("suiem")
      .withPassword("test")
      .start(),
    new RedisContainer("redis:7.4.6-alpine").start(),
  ]);
  const ownerUrl = pgc.getConnectionUri();
  await migrate(ownerUrl);
  await seed(ownerUrl);
  const owner = new pg.Client({ connectionString: ownerUrl });
  await owner.connect();
  await owner.query("ALTER ROLE suiem_app LOGIN PASSWORD 'test_app'");
  await owner.end();
  const appUrl = new URL(ownerUrl);
  appUrl.username = "suiem_app";
  appUrl.password = "test_app";

  // 2. Local chains for the API's boot chain-ID check (nothing is ever broadcast).
  const [mainnetPort, testnetPort, apiPort, proxyPort, fixturePort] = await Promise.all([
    freePort(),
    freePort(),
    freePort(),
    freePort(),
    freePort(),
  ]);
  for (const [port, id] of [
    [mainnetPort, 4663],
    [testnetPort, 46630],
  ] as const) {
    children.push(
      spawn("anvil", ["--port", String(port), "--chain-id", String(id), "--silent"], {
        stdio: "ignore",
      }),
    );
  }

  // Boot checks $WIF's identity on 4663 once SuiemElections is deployed: install the burnable mock
  // (pure name/symbol/decimals) at the real $WIF address on the local mainnet stand-in.
  const mainnetUrl = `http://127.0.0.1:${mainnetPort}`;
  const rpc = (method: string, params: unknown[] = []) =>
    fetch(mainnetUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }).then((r) => r.json() as Promise<{ error?: unknown }>);
  for (let i = 0; i < 50; i++) {
    if (
      await rpc("eth_chainId").then(
        () => true,
        () => false,
      )
    )
      break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const mock = JSON.parse(
    readFileSync(
      join(ROOT, "packages", "contracts", "out", "LocalWIF.sol", "LocalWIF.json"),
      "utf8",
    ),
  );
  const set = await rpc("anvil_setCode", [WIF.address, mock.deployedBytecode.object]);
  if (set.error) throw new Error(`anvil_setCode failed: ${JSON.stringify(set.error)}`);

  // 3. The real API
  // No live AI or data providers in E2E: strip keys and run no research worker. The spec simulates
  // a completed brief in the database to check the side panel.
  const apiEnv = { ...process.env };
  for (const k of ["GROQ_API_KEY", "GEMINI_API_KEY", "FINNHUB_API_KEY", "SEC_USER_AGENT"])
    delete apiEnv[k];
  const api = spawn("node", ["--import", "tsx", "src/main.ts"], {
    cwd: join(ROOT, "apps", "api"),
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...apiEnv,
      RESEARCH_WORKER: "off",
      REPUTATION_JOBS: "off",
      NODE_ENV: "test",
      API_PORT: String(apiPort),
      WEB_ORIGIN: "http://localhost:3000",
      DATABASE_URL: appUrl.toString(),
      REDIS_URL: redis.getConnectionUrl(),
      SESSION_SECRET: "e2e-session-secret-0123456789abcdef",
      COOKIE_SECURE: "false",
      WEBAUTHN_RP_ID: "localhost",
      MAINNET_RPC_URL: mainnetUrl,
      TESTNET_RPC_URL: `http://127.0.0.1:${testnetPort}`,
      RATE_LIMIT_DISABLED: "true",
      EXTENSION_ID: key.extensionId,
      LOG_LEVEL: "warn",
    },
  });
  children.push(api);
  await waitFor(`http://127.0.0.1:${apiPort}/api/v1/health`);

  // 4. Counting proxy: every extension request passes through here and is logged.
  const log: LoggedRequest[] = [];
  const proxy = createServer(async (req, res) => {
    if (req.url === "/__log") return void res.end(JSON.stringify(log));
    if (req.url === "/__reset") {
      log.length = 0;
      return void res.end("[]");
    }
    const body = await readBody(req);
    let parsed: unknown;
    try {
      parsed = body.length ? JSON.parse(body.toString("utf8")) : undefined;
    } catch {
      parsed = body.toString("utf8");
    }
    log.push({
      method: req.method ?? "",
      path: req.url ?? "",
      origin: (req.headers.origin as string | undefined) ?? null,
      hasAuth: !!req.headers.authorization,
      hasCookie: !!req.headers.cookie,
      body: parsed,
      at: Date.now(),
    });
    const upstream = request(
      {
        host: "127.0.0.1",
        port: apiPort,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: `127.0.0.1:${apiPort}` },
      },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on("error", () => res.writeHead(502).end());
    upstream.end(body);
  });
  await new Promise<void>((r) => proxy.listen(proxyPort, "127.0.0.1", r));
  servers.push(proxy);

  // 5. Fixture pages (X-like posts) on a host the E2E build is granted: http://localhost
  const fixtures = createServer((req, res) => {
    const page = FIXTURES[(req.url ?? "/").split("?")[0]!.replace(/^\//, "")];
    if (!page) return void res.writeHead(404).end("not found");
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
  });
  await new Promise<void>((r) => fixtures.listen(fixturePort, "127.0.0.1", r));
  servers.push(fixtures);

  // 6. Build the E2E variant of the extension, pointed at the counting proxy.
  execFileSync("pnpm", ["exec", "wxt", "build"], {
    cwd: EXT_DIR,
    stdio: "ignore",
    env: {
      ...process.env,
      SUIEM_E2E: "1",
      SUIEM_E2E_HOSTS: "http://localhost/*",
      SUIEM_API_BASE: `http://127.0.0.1:${proxyPort}/api/v1`,
      SUIEM_WEB_ORIGIN: "http://localhost:3000",
    },
  });

  process.env.E2E_API_URL = `http://127.0.0.1:${apiPort}/api/v1`;
  process.env.E2E_PROXY_URL = `http://127.0.0.1:${proxyPort}`;
  process.env.E2E_FIXTURE_URL = `http://localhost:${fixturePort}`;
  process.env.E2E_EXT_PATH = join(EXT_DIR, ".output-e2e", "chrome-mv3");
  process.env.E2E_EXT_ID = key.extensionId;
  process.env.E2E_PG_URL = ownerUrl;

  return async () => {
    for (const c of children) c.kill();
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
    await Promise.all([pgc.stop(), redis.stop()]);
  };
}
