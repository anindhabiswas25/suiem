# Suiem

**Research first, invest second.** Suiem is a research and investing community on Robinhood Chain. A browser extension spots the companies you read about. An AI research engine turns them into cited briefs. You write theses, trade Stock Tokens on testnet, and build a transparent track record. Each week the community picks its best researchers and investors by **burning real $WIF** in onchain elections.

> Suiem is not affiliated with Robinhood Markets, Inc. Testnet assets have no value and are not securities. $WIF carries no promise of value or return. Nothing in Suiem is investment advice.

| | |
| --- | --- |
| **Live app** | _add Vercel URL_ |
| **API** | _add Railway URL_ (`/api/v1/health`, OpenAPI at `/api/v1/openapi.json`) |
| **Elections contract (mainnet 4663)** | [`0xDB6CC943E480b4E003d458705B7B35e55F69009D`](https://robinhoodchain.blockscout.com/address/0xDB6CC943E480b4E003d458705B7B35e55F69009D) (verified) |
| **$WIF** | [`0x5173b8eA6923c2d40267890D45C46a3480954773`](https://robinhoodchain.blockscout.com/address/0x5173b8eA6923c2d40267890D45C46a3480954773) |

---

## Contents

- [The product](#the-product)
- [The $WIF flywheel](#the-wif-flywheel)
- [Real onchain transactions](#real-onchain-transactions)
- [Architecture](#architecture)
- [Safety and trust model](#safety-and-trust-model)
- [Run it locally](#run-it-locally)
- [Tests and checks](#tests-and-checks)
- [Deployment](#deployment)
- [Repository layout](#repository-layout)
- [Documentation](#documentation)

---

## The product

```
 Browse the web ──► Suiem Intelligence ──► AI research brief ──► Watchlist / thesis
 (extension)        detects companies       (cited sources)              │
                    locally                                              ▼
 $WIF election ◄── Suiem Score ◄── Feed, comments, ◄── Testnet Stock Token
 (burn to vote)    (50% investing,   helpful votes      or paper trade
                    50% research)
```

| Area | What it does | Network |
| --- | --- | --- |
| **Suiem Intelligence** (Chrome extension) | Detects companies and tickers on the page **locally**, shows a dismissible card, and opens research in a side panel. Modes ON / PAUSED / OFF / PRIVATE truly gate all work: OFF and PAUSED mean zero network activity. Local daily digest. | Off-chain |
| **AI research** | Briefs that follow a versioned schema, built only from retrieved sources (SEC EDGAR filings, Finnhub news and quotes). Every claim carries a citation, and uncited claims are rejected. Follow-up questions, side-by-side compare, feedback. Groq `gpt-oss-120b` is the primary model, with Gemini Flash as fallback. | Off-chain |
| **Watchlists and theses** | Multiple watchlists with notes and live quotes. Versioned theses with optional AI drafting (always labelled), a horizon and a review date. | Off-chain |
| **Invest** | Order preview with a signed EIP-712 quote, fees, slippage, a 55-second expiry and an `eth_simulateV1` check. The wallet signs an exact approve and then the trade. Suiem reconciles the fill from the receipt. Simulated (paper), testnet and faucet holdings are kept as **separate books** and never summed. Restricted jurisdictions are blocked server-side. | Testnet 46630 |
| **Social** | Profiles with **per-field privacy** (private by default), follow / mute / block, posts and theses, comments, helpful votes, bookmarks, sector communities, Discover and Following feeds, notifications, moderation with appeals. User text is only ever rendered as plain text. | Off-chain |
| **Suiem Score** | Deterministic integer formula: 50% investor quality (risk-adjusted, against an SPY benchmark) and 50% research contribution (rater-diversity weighted). "Building track record" until the thresholds are met. Methodology is public and reproducible. **Votes and $WIF never change the score.** | Off-chain |
| **$WIF elections** | Weekly *Research Contributor* and *Investor* elections. Candidates are frozen from opted-in leaderboard members. 1 $WIF burned = 1 vote, with a per-wallet cap. Live tally, finality and an as-of block. A review screen spells out that the burn is irreversible. | **Mainnet 4663** |

## The $WIF flywheel

```
 research & publish theses ──► weekly elections ("Research Contributor", "Investor")
          ▲                         │  community votes by BURNING $WIF (1 $WIF = 1 vote)
          │                         ▼
 more research & better theses ◄── winners: profile spotlight + winner badge
```

- **Recurring, real use.** Every election consumes $WIF through `burnFrom`, so `totalSupply` actually drops. This is not a transfer to a dead address.
- **Can't be bought into the score.** The Suiem Score is computed separately from votes and holdings (ADR-0005), so a spotlight never becomes a ranking advantage.
- **No custody.** `SuiemElections` never holds tokens. The voter approves the exact amount, and the contract burns it in the same call.

## Real onchain transactions

### Robinhood Chain mainnet (4663): `SuiemElections` with real $WIF

| What | Transaction |
| --- | --- |
| Deploy `SuiemElections` (block 111,713,485) | [`0x851a241f…11e2`](https://robinhoodchain.blockscout.com/tx/0x851a241f55fc0f1ce54aef618d42afd5141adbed864b89d6ba52badfde1711e2) |
| Create election #1 (Research Contributor, 3 candidates, cap 25 votes per wallet) | [`0x53ea45d5…aeb7`](https://robinhoodchain.blockscout.com/tx/0x53ea45d5baea21d0c9007cfc6b02dbd1c1cb6b89bd865ae6a12999a0e73caeb7) |
| Vote 1: exact approve of 3 $WIF | [`0x5c129e0d…28f0`](https://robinhoodchain.blockscout.com/tx/0x5c129e0d27b895e7633087d595c057624994685e0c9a2061ecbd9f02206328f0) |
| Vote 1: `vote(1, 1, 3)`, **3 $WIF burned** | [`0x73820307…b3d2`](https://robinhoodchain.blockscout.com/tx/0x738203074f5184f605329e1d87f377e5c447ee401a7634c7304e91a7ffd7b3d2) |
| Vote 2: exact approve of 1 $WIF | [`0x5cc0a04f…a7a3`](https://robinhoodchain.blockscout.com/tx/0x5cc0a04fc4ae76ed861581d098a865c25aab03ed0d2002d024c3616aa8faa7a3) |
| Vote 2: `vote(1, 2, 1)`, **1 $WIF burned** | [`0x890e3dac…510c`](https://robinhoodchain.blockscout.com/tx/0x890e3dac00eb7a0dd974d2cebd7874f992c456096348ede305f1c9d5af8c510c) |
| `finalize(1)`: final tallies 3 / 1 / 0 | [`0x414f4ecc…9ac5`](https://robinhoodchain.blockscout.com/tx/0x414f4ecc2d660af04c3fe2b4e0659ef1ae0671154bd6d2573c69d7c188489ac5) |

Checked after each vote:
- `totalSupply` fell by exactly the burned amount.
- The contract's $WIF balance and the leftover allowance are 0.
- The indexer's tallies match `tallies(1)` on the contract.

### Robinhood Chain testnet (46630): Stock Token venue (all Blockscout-verified)

| Contract | Address |
| --- | --- |
| `SuiemDemoVenue` (EIP-712 quotes, nonce, 60 s expiry, `minOut`, pause, `Ownable2Step`) | [`0xfdc5…704F`](https://explorer.testnet.chain.robinhood.com/address/0xfdc540781EE7ab03fD397201A21B87Cf2321704F) |
| `DemoUSD` (dUSD, faucet: 1,000 per 24 h) | [`0xbB97…D045`](https://explorer.testnet.chain.robinhood.com/address/0xbB9795F4b4Bddb993539Ee44249D83E7625DD045) |
| dTSLA · dAMZN · dPLTR · dNFLX · dAMD | [`0xb46d…2731`](https://explorer.testnet.chain.robinhood.com/address/0xb46d40bbfb8798c93b0def0eac6b5cc66fd02731) · [`0xb7a3…17A6`](https://explorer.testnet.chain.robinhood.com/address/0xb7a347D53CbC404BC8b9612e0df4B04450b217A6) · [`0xc782…8633`](https://explorer.testnet.chain.robinhood.com/address/0xc7821521505D5cad7A094805953a788136458633) · [`0xd0cb…80A4`](https://explorer.testnet.chain.robinhood.com/address/0xd0cb704D45cdf60f07512a4DCa5e2791F97680A4) · [`0xC6D7…0a21`](https://explorer.testnet.chain.robinhood.com/address/0xC6D7F579208e2f62Ae798a757ad87F3ceC280a21) |

| Trade | Transaction |
| --- | --- |
| Claim 1,000 dUSD | [`0x0da5430b…17db`](https://explorer.testnet.chain.robinhood.com/tx/0x0da5430b40f5c7f390eca40fd1c942cfc7c3ec679fd7a282992a4a11eb4517db) |
| Exact approve of 25 dUSD | [`0x85e3e0e2…6601`](https://explorer.testnet.chain.robinhood.com/tx/0x85e3e0e2faf2efc29f5f2e5826fcb4ae174500396968b04a362b63f0890d6601) |
| Buy dTSLA for 25 dUSD (reconciled → filled) | [`0xa32957e0…bcba6`](https://explorer.testnet.chain.robinhood.com/tx/0xa32957e0c62575d26a42886cd537a349d30d9c247543c3c221669115a14bcba6) |
| Sell 0.032881 dTSLA (reconciled → filled) | [`0x81837575…2432`](https://explorer.testnet.chain.robinhood.com/tx/0x81837575db3c3d20d53735c88228de340862e33e15fd4fa0e8e87932e4e52432) |

Robinhood's own testnet Stock Tokens (TSLA, AMZN, PLTR, NFLX, AMD) are verified by tracing faucet mints and are listed in the registry as faucet holdings.

## Architecture

```
              ┌──────────────────────┐        ┌──────────────────────────┐
  Chrome ────►│ Suiem Intelligence   │──────► │                          │
              │ (WXT, MV3)           │ device │                          │
              └──────────────────────┘ token  │   API (NestJS+Fastify)   │──► Postgres 16
              ┌──────────────────────┐        │   /api/v1, Zod, OpenAPI  │──► Redis (BullMQ,
  Browser ───►│ Web (Next.js, wagmi) │──────► │                          │    rate limits)
              └─────────┬────────────┘ cookie │  ┌ research worker ──────┼──► Groq / Gemini,
                        │ user-signed tx      │  ├ reputation jobs       │    SEC EDGAR, Finnhub
                        ▼                     │  └ elections indexer ────┼──► Robinhood Chain RPC
              Robinhood Chain 4663 / 46630    └──────────────────────────┘    (read-only)
```

- **Monorepo:** pnpm workspaces + Turborepo, TypeScript end to end, Node 24.
- **Web:** Next.js App Router, React, TanStack Query, wagmi + viem for both chains. Sign-in uses passkeys (WebAuthn) or wallets (SIWE).
- **API:** NestJS on Fastify. Every request and response is Zod-validated, and the OpenAPI spec is generated from the same schemas. CSRF protection, per-route rate limits, audit log.
- **Data:** PostgreSQL 16 with plain SQL migrations and a Drizzle schema. Money is `bigint` only, and a lint rule bans floats in money code.
- **Chain:** viem everywhere. App code may not build state-changing calls: the only write paths are reviewed builders in `packages/chain`, enforced by ESLint and a test.
- **Contracts:** Foundry with Solidity 0.8.30 and OpenZeppelin 5. Unit, fuzz, invariant and mainnet-fork tests.
- **Extension:** WXT (Manifest V3) with a background worker, a content detector, popup, side panel and options.

Full design: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Safety and trust model

- **Never buys automatically.** Every trade and every vote is previewed, reviewed and signed by the user in their own wallet. The wallet is asked for the exact amount, never an unlimited allowance.
- **The calldata the user signs is checked twice.** The server builds the calldata from the registry and binds it to a preview hash. The client re-encodes the call and compares it before the wallet is asked to sign.
- **Elections contract:** it holds no tokens and can't be upgraded. The owner can only create elections, add candidates and cancel before the start. `burnFrom` is protected by a `totalSupply` check.
- **Server-side mainnet RPC only.** The private RPC URL never reaches the browser, logs or errors. A repo-wide test and a redaction test enforce this.
- **Privacy by default.** Every profile field is private until the user opts in. Showing a wallet address requires an explicit acknowledgement that onchain history becomes linked to the profile.
- **AI output is data, not instructions.** Page text is delimited and treated as data. Output must match a schema and cite real retrieved sources. AI-assisted content is always labelled.
- **Jurisdictions.** Stock Token features are gated server-side against Robinhood's restricted-jurisdictions list. An undeclared country is blocked. Research and paper trading work everywhere.

## Run it locally

**Prerequisites:** Node 24.21+ (`.nvmrc`), pnpm 11.17 (`corepack enable`), Docker with Compose v2.20+, and [Foundry](https://getfoundry.sh) (`forge`, `anvil`).

```bash
git clone <this repo> suiem && cd suiem
docker compose up -d --wait   # Postgres 16 + Redis (local-only credentials)
pnpm install
pnpm db:migrate               # creates .env with local defaults on first run
pnpm db:seed                  # companies, instruments, communities, consent purposes
pnpm dev                      # web http://localhost:3000 · API http://localhost:4000/api/v1
```

Open http://localhost:3000 and sign in with a **passkey** or a **wallet**. Research needs a free [Groq](https://console.groq.com) key (`GROQ_API_KEY`), optionally a [Gemini](https://aistudio.google.com) key as fallback, and a free [Finnhub](https://finnhub.io) key. Every variable is documented in [`.env.example`](.env.example).

If port 5432 or 6379 is taken, set `SUIEM_PG_PORT` / `SUIEM_REDIS_PORT` in `.env` and update `DATABASE_URL`, `DATABASE_OWNER_URL` and `REDIS_URL` to match.

**Extension:**

```bash
pnpm --filter @suiem/extension build    # → apps/extension/.output/chrome-mv3
```

Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick `apps/extension/.output/chrome-mv3`. Then link it from **Settings → Suiem Intelligence** in the web app.

## Tests and checks

```bash
pnpm typecheck               # every package
pnpm lint                    # ESLint: no floats in money code, no ad-hoc chain writes
pnpm format:check            # Prettier
pnpm depcruise               # architecture rules (e.g. elections can't import the score engine)
pnpm test                    # unit: 255 tests
pnpm test:integration        # Testcontainers Postgres + Redis + local anvil chains: 156 tests
pnpm test:e2e:extension      # Playwright against the built extension and the real API
pnpm contracts:build && (cd packages/contracts && forge test)   # unit, fuzz, invariant, fork
pnpm check                   # all of the above except E2E
```

Among the things the suites prove:
- OFF and PAUSED in the extension mean **zero** network requests.
- A tampered amount, target or sender is rejected before signing.
- $WIF never changes the Suiem Score.
- The indexer survives reorgs and halving of the log range.
- Every privacy field is enforced for every kind of viewer.
- Device tokens get a 403 on every social and vote route.

CI (`.github/workflows/`) runs static checks, integration tests, the extension E2E suite, contracts, CodeQL and a gitleaks secret scan.

## Deployment

| Piece | Host | Notes |
| --- | --- | --- |
| Web (`apps/web`) | Vercel | Root `apps/web`. Set `API_URL` to the Railway API; `/api/v1/*` is proxied, so cookies stay first-party |
| API (`apps/api`, with the research worker, reputation jobs and elections indexer in-process) | Railway | Needs Postgres and Redis plugins and the variables in `.env.example`. `MAINNET_RPC_URL` is set here only |
| Postgres 16, Redis | Railway | Run `pnpm db:migrate && pnpm db:seed` once against the production database |
| Extension | Chrome Web Store (unlisted), or a release `.zip` | `pnpm --filter @suiem/extension zip`. Build with the production API origin |

## Repository layout

```
apps/
  web/            Next.js app: research, watchlists, theses, invest, feed, profiles, communities,
                  leaderboard, elections (burn-to-vote drawer), notifications, settings
  api/            NestJS + Fastify API, /api/v1 (auth, research, orders, social, reputation, elections)
  extension/      Suiem Intelligence: Chrome MV3 extension (WXT)
packages/
  config/         chains 4663/46630, $WIF constant, feature→network map, env registry, restricted list
  shared/         Zod schemas, bigint money library, consent state machine, research brief schema, events
  db/             SQL migrations, Drizzle schema, seed
  chain/          viem clients, typed ABIs, reviewed write builders, secret-safe RPC transport
  ui/             design system (tokens, components) shared by web and extension
  contracts/      Foundry: SuiemElections, SuiemDemoVenue, DemoUSD, DemoStockToken + deploy manifests
workers/
  research/       AI research pipeline (retrieval → model → schema validation → citation check)
  reputation/     deterministic Suiem Score engine and jobs
  indexer/        reorg-safe SuiemElections indexer with finality and onchain cross-check
infra/            docker compose for local Postgres, Redis, Mailpit and anvil forks
scripts/          env tooling, smoke scripts, owner CLI
docs/             architecture, ADRs, verified chain facts, reputation methodology, policies
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): components, data flow, trust boundaries, threat model
- [`docs/ADR/`](docs/ADR/README.md): architecture decision records (product boundaries, chain and wallet, privacy, execution, reputation and voting, AI, stack, two networks)
- [`docs/REPUTATION_METHODOLOGY.md`](docs/REPUTATION_METHODOLOGY.md): the Suiem Score, with a worked example
- [`docs/VERIFIED_FACTS.md`](docs/VERIFIED_FACTS.md): every chain fact Suiem relies on and how it was verified
- [`packages/contracts/README.md`](packages/contracts/README.md): contracts, trust model, deployment and verification

## License

All rights reserved unless a license file is added.
