// Creates .env with LOCAL-ONLY defaults on first run (never overwrites). Values match infra/docker-compose.yml.
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const path = join(import.meta.dirname, "..", ".env");
if (existsSync(path)) process.exit(0);
const values = {
  NODE_ENV: "development",
  API_PORT: "4000",
  WEB_ORIGIN: "http://localhost:3000",
  API_URL: "http://localhost:4000",
  DATABASE_URL: "postgres://suiem_app:local_only_app@localhost:5432/suiem",
  DATABASE_OWNER_URL: "postgres://suiem:local_only@localhost:5432/suiem",
  REDIS_URL: "redis://localhost:6379",
  SESSION_SECRET: randomBytes(32).toString("base64url"),
  COOKIE_SECURE: "false",
  WEBAUTHN_RP_ID: "localhost",
  WEBAUTHN_RP_NAME: "Suiem",
  LOG_LEVEL: "info",
  // Stable ID from apps/extension/extension-key.json (public, not a secret): enables one-click pairing.
  EXTENSION_ID: "cpgeijpinjipcioicabhgfmcbacdkmcj",
};
writeFileSync(
  path,
  `# Local development only (created by scripts/ensure-env.mjs). Git-ignored.\n${Object.entries(
    values,
  )
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")}\n`,
);
console.log("created .env with local defaults");
