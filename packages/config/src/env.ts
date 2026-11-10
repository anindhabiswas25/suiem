import { z } from "zod";

/**
 * Every environment variable Suiem reads, with a description. `.env.example` is checked
 * against this list by `env.test.ts`, so the two cannot drift apart.
 */
export const ENV_VARS = {
  NODE_ENV:
    "Runtime mode: development | test | production. Production refuses single-maintainer mode.",
  API_PORT: "Port the API listens on (default 4000).",
  WEB_ORIGIN:
    "Exact origin of the web app, e.g. http://localhost:3000. Used for CORS, CSRF Origin checks, WebAuthn and SIWE domain binding.",
  API_URL: "Base URL the web app proxies /api/* to (server-side only).",
  DATABASE_URL: "Postgres URL for the RLS-enforced application role (suiem_app).",
  DATABASE_SYSTEM_URL:
    "Postgres URL for the RLS-bypassing system role (suiem_system), used only by privileged modules.",
  DATABASE_OWNER_URL: "Postgres URL for the schema owner (migrations and seed only).",
  REDIS_URL: "Redis URL for rate limits, WebAuthn challenges and OTP attempt counters.",
  SESSION_SECRET: "32+ byte random secret used to HMAC session tokens and OTP codes.",
  COOKIE_SECURE:
    "true|false: set the Secure flag on cookies (true everywhere except non-localhost http).",
  WEBAUTHN_RP_ID: "WebAuthn relying-party ID (hostname of WEB_ORIGIN, e.g. localhost).",
  WEBAUTHN_RP_NAME: "WebAuthn relying-party display name.",
  SMTP_HOST: "SMTP host for the EmailProvider (Mailpit locally).",
  SMTP_PORT: "SMTP port (Mailpit: 1025).",
  EMAIL_FROM: "From address for transactional email.",
  CHAIN_RPC_URL:
    "Override RPC URL. Defaults to the verified public testnet RPC. The chainId must be 46630 or boot fails.",
  ALCHEMY_API_KEY:
    "Optional. Enables the Alchemy testnet RPC as primary with public fallback (ADR-0002).",
  OTEL_EXPORTER_OTLP_ENDPOINT:
    "Optional OTLP/HTTP collector endpoint, e.g. http://localhost:4318. Unset disables export.",
  OTEL_SERVICE_NAME: "Service name reported to OpenTelemetry.",
  LOG_LEVEL: "Pino log level (info by default).",
  ADMIN_SINGLE_MAINTAINER_MODE:
    "true|false: acknowledges a single human operating both seeded admins (ADR-0010). Forbidden in production.",
  RATE_LIMIT_DISABLED:
    "true|false: disables Redis rate limiting. Test-only; refused in production.",
} as const;

export type EnvVarName = keyof typeof ENV_VARS;

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

export const apiEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    WEB_ORIGIN: z.url(),
    DATABASE_URL: z.string().startsWith("postgres"),
    DATABASE_SYSTEM_URL: z.string().startsWith("postgres"),
    REDIS_URL: z.string().startsWith("redis"),
    SESSION_SECRET: z.string().min(32),
    COOKIE_SECURE: bool.default(true),
    WEBAUTHN_RP_ID: z.string().min(1),
    WEBAUTHN_RP_NAME: z.string().min(1).default("Suiem"),
    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().default(1025),
    EMAIL_FROM: z.email(),
    CHAIN_RPC_URL: z.url().optional(),
    ALCHEMY_API_KEY: z.string().optional(),
    OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
    OTEL_SERVICE_NAME: z.string().default("suiem-api"),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    ADMIN_SINGLE_MAINTAINER_MODE: bool.default(false),
    RATE_LIMIT_DISABLED: bool.default(false),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && env.ADMIN_SINGLE_MAINTAINER_MODE) {
      ctx.addIssue({
        code: "custom",
        message: "ADMIN_SINGLE_MAINTAINER_MODE is forbidden in production (ADR-0010).",
      });
    }
    if (env.NODE_ENV === "production" && env.RATE_LIMIT_DISABLED) {
      ctx.addIssue({ code: "custom", message: "RATE_LIMIT_DISABLED is forbidden in production." });
    }
    if (env.NODE_ENV === "production" && !env.COOKIE_SECURE) {
      ctx.addIssue({ code: "custom", message: "COOKIE_SECURE must be true in production." });
    }
  });

export type ApiEnv = z.infer<typeof apiEnvSchema>;

export function loadApiEnv(source: Record<string, string | undefined> = process.env): ApiEnv {
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v !== ""),
  );
  const parsed = apiEnvSchema.safeParse(cleaned);
  if (!parsed.success) {
    // Names only, never values.
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "(env)"}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid API environment: ${issues}`);
  }
  return parsed.data;
}
