import { z } from "zod";

/**
 * Every environment variable Suiem reads, with a description. `.env.example` is checked
 * against this list by `env.test.ts`, so the two cannot drift apart.
 */
export const ENV_VARS = {
  NODE_ENV: "Runtime mode: development | test | production.",
  API_PORT: "Port the API listens on (default 4000).",
  WEB_ORIGIN:
    "Exact origin of the web app, e.g. http://localhost:3000. Used for CSRF Origin checks, WebAuthn and SIWE domain binding.",
  API_URL: "Base URL the web app proxies /api/* to (server-side only).",
  DATABASE_URL: "Postgres URL for the least-privilege API role suiem_app (NOSUPERUSER, no DDL).",
  DATABASE_OWNER_URL: "Postgres URL for the schema owner. Used only by db:migrate and db:seed.",
  REDIS_URL: "Redis URL for rate limits, WebAuthn challenges and SIWE nonces.",
  SESSION_SECRET: "32+ byte random secret used to HMAC session tokens.",
  COOKIE_SECURE: "true|false: set the Secure flag on cookies.",
  WEBAUTHN_RP_ID: "WebAuthn relying-party ID (hostname of WEB_ORIGIN, e.g. localhost).",
  WEBAUTHN_RP_NAME: "WebAuthn relying-party display name.",
  MAINNET_RPC_URL:
    "SECRET (server-side only, never NEXT_PUBLIC_). Mainnet 4663 RPC for the API, indexer and scripts, e.g. the PO's QuickNode URL (contains its token). Default: verified public RPC.",
  TESTNET_RPC_URL:
    "Optional RPC override for Robinhood Chain testnet 46630 (default: verified public RPC).",
  ALCHEMY_API_KEY:
    "Optional. Enables Alchemy as primary RPC with public fallback on both networks.",
  LOG_LEVEL: "Pino log level (info by default).",
  GROQ_API_KEY: "Groq API key (primary research model). Never logged.",
  GROQ_MODEL: "Groq model ID (default openai/gpt-oss-120b; strict structured outputs).",
  GEMINI_API_KEY: "Google Gemini API key (fallback research model, free tier). Never logged.",
  GEMINI_MODEL: "Gemini model ID (default gemini-3.5-flash; see VERIFIED_FACTS R-02).",
  FINNHUB_API_KEY:
    "Finnhub API key (news, quotes, profile, peers, metrics; free plan). Never logged.",
  SEC_USER_AGENT:
    "User-Agent sent to SEC EDGAR, e.g. 'Suiem research contact@example.com'. Required by the SEC.",
  RESEARCH_DAILY_LIMIT_PER_USER: "Research briefs per user per UTC day (default 10).",
  RESEARCH_CACHE_TTL_HOURS:
    "Hours a public-data-only brief and provider responses may be reused (default 12).",
  QUOTE_SIGNER_PRIVATE_KEY:
    "Testnet-only key that signs SuiemDemoVenue EIP-712 quotes (chain 46630 only). Never logged.",
  TESTNET_DEPLOYER_PRIVATE_KEY:
    "Testnet-only deployer for packages/contracts (chain 46630 only). Used by the deploy script, not the API.",
  DEMO_DEPLOYMENT_FILE:
    "Path to the SuiemDemoVenue deployment manifest (default packages/contracts/deployments/46630.json).",
  SEED_DEMO:
    "`pnpm db:seed` only: set to false to skip the sample community accounts and posts (production).",
  ORDER_MAX_USD_PER_ORDER: "Largest order in USD (default 1000).",
  ORDER_MAX_USD_PER_DAY: "Largest total order value per user per UTC day in USD (default 5000).",
  DEMO_FEE_BPS: "Fee in basis points signed into demo venue quotes (default 10).",
  SIM_FEE_BPS: "Simulated book fee in basis points (default 10).",
  SIM_SLIPPAGE_BPS:
    "Simulated book slippage in basis points, applied against the trader (default 5).",
  ORDER_MAX_SLIPPAGE_BPS: "Default slippage bound used for minOut (default 50).",
  RESEARCH_WORKER:
    "inline (default): the API process also runs the research queue worker. off: run workers/research separately.",
  REPUTATION_JOBS:
    "inline (default): the API process runs the reputation jobs (SPY marks, thesis evaluation, score snapshots) every 15 minutes. off: disabled.",
  INDEXER:
    "inline (default): the API process runs the SuiemElections indexer (mainnet 4663) when deployments/4663.json exists. off: run workers/indexer separately.",
  INDEXER_LOG_RANGE:
    "Blocks per eth_getLogs request (default 5000; QuickNode allows 10,000). Halved automatically on a range error.",
  INDEXER_POLL_MS: "Indexer poll interval in ms (default 12000).",
  RPC_MAX_RPS:
    "Max JSON-RPC requests per second per endpoint from the API/indexer (default 15). Plan-limit guard.",
  EXTENSION_ID:
    "Optional Chrome extension ID. If set, extension requests must come from chrome-extension://<id> and the web app offers one-click pairing.",
  NEXT_PUBLIC_EXTENSION_ID:
    "Web build: extension ID for one-click pairing (default extension key gives cpgeijpinjipcioicabhgfmcbacdkmcj).",
  TRUST_PROXY_HOPS:
    "Number of trusted reverse-proxy hops in front of the API (0 = trust none). Set exactly; never trust all hops.",
  RATE_LIMIT_DISABLED:
    "true|false: disables Redis rate limiting. Test-only; refused in production.",
  FLAG_TRADING_TESTNET: "Env override for the trading.testnet flag (true|false).",
  FLAG_ELECTIONS: "Env override for the elections flag (true|false).",
  FLAG_CAMPAIGNS: "Env override for the campaigns flag (true|false).",
} as const;

export type EnvVarName = keyof typeof ENV_VARS;

const bool = z.enum(["true", "false"]).transform((v) => v === "true");

export const apiEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_PORT: z.coerce.number().int().min(0).max(65535).default(4000),
    WEB_ORIGIN: z.url(),
    DATABASE_URL: z.string().startsWith("postgres"),
    REDIS_URL: z.string().startsWith("redis"),
    SESSION_SECRET: z.string().min(32),
    COOKIE_SECURE: bool.default(true),
    WEBAUTHN_RP_ID: z.string().min(1),
    WEBAUTHN_RP_NAME: z.string().min(1).default("Suiem"),
    MAINNET_RPC_URL: z.url().optional(),
    TESTNET_RPC_URL: z.url().optional(),
    ALCHEMY_API_KEY: z.string().optional(),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    FLAG_TRADING_TESTNET: bool.optional(),
    FLAG_ELECTIONS: bool.optional(),
    FLAG_CAMPAIGNS: bool.optional(),
    RATE_LIMIT_DISABLED: bool.default(false),
    EXTENSION_ID: z
      .string()
      .regex(/^[a-p]{32}$/)
      .optional(),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    GROQ_API_KEY: z.string().min(10).optional(),
    GROQ_MODEL: z.string().min(1).default("openai/gpt-oss-120b"),
    GEMINI_API_KEY: z.string().min(10).optional(),
    GEMINI_MODEL: z.string().min(1).default("gemini-3.5-flash"),
    FINNHUB_API_KEY: z.string().min(10).optional(),
    SEC_USER_AGENT: z.string().min(5).optional(),
    RESEARCH_DAILY_LIMIT_PER_USER: z.coerce.number().int().min(1).max(1000).default(10),
    RESEARCH_CACHE_TTL_HOURS: z.coerce.number().int().min(0).max(168).default(12),
    RESEARCH_WORKER: z.enum(["inline", "off"]).default("inline"),
    REPUTATION_JOBS: z.enum(["inline", "off"]).default("inline"),
    INDEXER: z.enum(["inline", "off"]).default("inline"),
    INDEXER_LOG_RANGE: z.coerce.number().int().min(1).max(10_000).default(5000),
    INDEXER_POLL_MS: z.coerce.number().int().min(1000).max(600_000).default(12_000),
    RPC_MAX_RPS: z.coerce.number().int().min(0).max(1000).default(15),
    QUOTE_SIGNER_PRIVATE_KEY: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .optional(),
    TESTNET_DEPLOYER_PRIVATE_KEY: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .optional(),
    DEMO_DEPLOYMENT_FILE: z.string().min(1).optional(),
    SEED_DEMO: z.enum(["true", "false"]).optional(),
    ORDER_MAX_USD_PER_ORDER: z.coerce.number().int().min(1).max(1_000_000).default(1000),
    ORDER_MAX_USD_PER_DAY: z.coerce.number().int().min(1).max(10_000_000).default(5000),
    DEMO_FEE_BPS: z.coerce.number().int().min(0).max(100).default(10),
    SIM_FEE_BPS: z.coerce.number().int().min(0).max(100).default(10),
    SIM_SLIPPAGE_BPS: z.coerce.number().int().min(0).max(100).default(5),
    ORDER_MAX_SLIPPAGE_BPS: z.coerce.number().int().min(0).max(1000).default(50),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production" && !env.EXTENSION_ID) {
      ctx.addIssue({
        code: "custom",
        message:
          "EXTENSION_ID is required in production so only the real extension can pair (security review).",
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
