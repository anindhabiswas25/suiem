# SUIEM --- Product Requirements Document (PRD)

**Document status:** Product baseline for discovery, architecture,
implementation and validation\
**Version:** 1.0\
**Product name:** Suiem\
**Product category:** AI-powered social investing and research network\
**Target chain:** Robinhood Chain (EVM-compatible; chain configuration
must be verified against official documentation before implementation)\
**Reference implementation:** [Banchor ---
soumyacodes007/banchor](https://github.com/soumyacodes007/banchor)\
**Reference PRD:** [Banchor
docs/PRD.md](https://github.com/soumyacodes007/banchor/blob/main/docs/PRD.md)\
**Last updated:** 10 November 2026

------------------------------------------------------------------------

## 0. Instructions for Claude Code and engineering agents

This document is the product source of truth for Suiem. Read it before
changing code.

### 0.1 Required repository inspection

Before implementation, clone and inspect the Banchor repository:

``` bash
git clone https://github.com/soumyacodes007/banchor.git reference-banchor
```

Inspect, at minimum:

-   `README.md`
-   `docs/PRD.md`
-   `backend/README.md`
-   `backend/` source, package files, configuration examples and address
    manifests
-   `contracts/` source, tests, deployment scripts and Foundry
    configuration
-   `extension/` manifest, service worker/background logic, content
    scripts, popup/options UI and local data
-   `web/` routes, components, hooks, wallet integration and API calls
-   `screenshots/`
-   `.gitignore` and any security documentation

The repository is a **reference implementation**, not an instruction to
copy every behaviour unchanged. Preserve useful, tested concepts and
identify what must be replaced. Do not assume its Monad contracts, test
tokens, mock venue, wallet SDK, passkey implementation, chain addresses,
prices, backend APIs or deployment configuration work on Robinhood
Chain.

The publicly visible Banchor README describes a Chrome extension,
Next.js web app, Node backend, SQLite event reconstruction,
Solidity/Foundry contracts, passkey smart account, mock USDC, mock
stocks and a mock router on Monad Testnet. Its original concepts include
attention tracking, highlight-to-buy, scroll-based purchases,
copy-basket, detox mode, portfolio roast cards and session-key spending
limits. The current Suiem requirements deliberately change the default
behaviour: **research detection and daily digest are enabled only with
user consent; passive browsing never triggers a stock purchase.**

### 0.2 Engineering-agent rules

1.  Do not begin by rewriting the entire reference repository. First
    produce a codebase audit and migration plan.
2.  Do not delete or replace existing working functionality until its
    purpose, dependencies and tests are understood.
3.  Do not invent deployed contract addresses, token addresses,
    supported stock tokens, market routes, RPC URLs, oracle feeds, API
    keys or provider capabilities.
4.  Verify chain ID, RPC, explorer, gas token, finality, supported
    wallet/account abstraction stack, token contract addresses and
    official \$WIF token details from authoritative current
    documentation.
5.  Treat all live trading, tokenized securities and financial
    promotions as gated capabilities until legal, provider, venue,
    jurisdiction and asset eligibility reviews are complete.
6.  Use testnet and clearly labelled simulated assets where real
    execution is not approved or available.
7.  Never represent mock stock tokens as real shares, real securities or
    real tokenized-equity exposure.
8.  Never send a transaction, create an order, transfer assets, increase
    spending limits or enable automatic execution without the user's
    explicit authorization.
9.  Never put private browsing history, raw page content, private
    research notes, credentials, wallet secrets or personal financial
    data onchain.
10. Never put secrets in source control. Provide `.env.example` with
    names and descriptions only.
11. Add tests for every financial calculation, permission boundary,
    contract state transition and critical user flow.
12. If a requirement is ambiguous or conflicts with the repository,
    record the conflict in `docs/decisions/` and ask for product-owner
    confirmation rather than silently guessing.

### 0.3 Required first deliverables from Claude Code

Before implementation, produce:

-   `docs/REPO_AUDIT.md` --- actual repository structure, modules,
    dependencies, existing tests, known gaps and reuse decisions.
-   `docs/TECHNICAL_GAP_ANALYSIS.md` --- what Banchor has versus what
    Suiem needs.
-   `docs/ARCHITECTURE.md` --- proposed production architecture and
    trust boundaries.
-   `docs/ADR/` --- architecture decision records for chain, wallet,
    data, AI, trading, scoring and voting.
-   `docs/IMPLEMENTATION_PLAN.md` --- dependency-ordered epics and
    acceptance criteria.
-   A proposed monorepo layout and migration plan that preserves the
    reference implementation until replacement modules pass tests.

Do not claim a repository audit is complete until the source has
actually been cloned and inspected.

------------------------------------------------------------------------

# 1. Executive summary

Suiem is an AI-powered social investing network that helps people turn
everyday discovery and research into informed investment decisions, a
verifiable record of their reasoning, useful investor relationships and
community participation.

Suiem connects four experiences:

1.  **Discover:** A user encounters a company, stock, product, news item
    or investment thesis while browsing.
2.  **Understand:** Suiem helps the user research the company using
    sourced information, financial data, news, competitor analysis and
    risk explanations.
3.  **Decide:** The user saves a watchlist item, writes a thesis,
    follows an asset or places an explicitly confirmed order through an
    approved trading integration.
4.  **Build identity:** The user can publish research and permitted
    portfolio information, receive feedback, build an evidence-based
    reputation and participate in community elections using \$WIF.

The product has five pillars:

-   **Suiem Intelligence:** Browser extension, entity detection,
    contextual research and daily digest.
-   **Suiem Invest:** Asset discovery, research workspace, watchlists,
    portfolios and supported trading.
-   **Suiem Social:** Profiles, research posts, communities, following
    and portfolio sharing.
-   **Suiem Reputation:** A 50/50 score based on investor performance
    and community contribution.
-   **Suiem Economy:** \$WIF-powered voting and community mechanisms,
    plus sponsor-funded rewards using an approved stablecoin or other
    permitted payment asset.

## 1.1 Product positioning

**Suiem --- Your attention. Your investments. Your influence.**

Suiem is not merely a broker, a stock screener, a browser tracker, a
copy-trading application or a token-voting website. It is a consumer
investing network in which research, investment decisions, social
knowledge and reputation reinforce one another.

## 1.2 Core product principles

-   Research before transaction.
-   User intent before automation.
-   Privacy by default.
-   Transparent sources and uncertainty.
-   Verifiable performance, not popularity.
-   Contribution quality, not engagement farming.
-   \$WIF has a genuine, bounded role; it is not forced into every
    workflow.
-   Stablecoin rewards are funded transparently; rewards are never
    promised from token appreciation.
-   Simulated and live financial experiences are unmistakably different.
-   Accessibility, safety, security and compliance are product
    requirements, not launch clean-up tasks.

------------------------------------------------------------------------

# 2. Product goals, non-goals and success criteria

## 2.1 Goals

1.  Reduce friction between discovering a company and conducting
    structured research.
2.  Make investment research understandable to new and experienced
    retail investors.
3.  Allow users to preserve the reasoning behind investment decisions
    and review it later.
4.  Provide a user-controlled extension that detects relevant
    public-page company context without invasive surveillance.
5.  Support watchlists, portfolio tracking and, only where approved,
    user-confirmed purchases of supported tokenized assets.
6.  Help users learn from other investors without presenting popularity
    as expertise.
7.  Create a fair reputation model that recognizes both investment
    process/outcomes and community contribution.
8.  Give \$WIF a recurring and transparent utility through community
    voting and elections.
9.  Support creator/community campaigns with separately funded rewards.
10. Build a reliable, auditable and extensible platform suitable for
    long-term operation.

## 2.2 Non-goals

Suiem is not intended to:

-   Guarantee investment returns or promise that attention produces
    profit.
-   Automatically buy stocks because a user scrolls, watches a video or
    visits a website.
-   Encourage compulsive browsing, trading, gambling-like behaviour or
    excessive transaction frequency.
-   Sell raw browsing histories or use private browsing data for
    advertising.
-   Provide individualized regulated investment advice unless the
    business has the required authorization.
-   Represent tokenized securities as direct share ownership unless the
    relevant legal instrument actually grants those rights.
-   Let users buy reputation, buy votes or pay to manipulate rankings.
-   Let a user's \$WIF balance determine their investor score.
-   Allow a public portfolio to trigger trades in another user's account
    without that user's explicit authorization.
-   Place sensitive personal data or private portfolio details onchain.
-   Launch real securities trading in a jurisdiction before legal and
    partner approval.
-   Depend on a single AI model, data provider, RPC endpoint or
    centralized indexer for correctness.

## 2.3 North-star metric

**Weekly Active Research Contributors (WARC):** unique users in a week
who complete at least one meaningful research action (for example, save
a sourced research brief, publish a substantive thesis, provide a
helpful review or complete a thesis review), excluding passive page
views and low-quality automated events.

This metric is preferred over raw browsing time, raw transaction count
or number of notifications.

## 2.4 Supporting metrics

### Activation

-   Account creation completion.
-   Extension installation and permission opt-in.
-   First company successfully detected.
-   First research panel opened.
-   First watchlist item or thesis saved.
-   First social follow.

### Engagement and retention

-   Weekly active research users.
-   Research sessions per active user.
-   Research-to-watchlist conversion.
-   Thesis creation and review rate.
-   Daily digest open/use rate.
-   D7, D30 and D90 retention.
-   Social follow and meaningful comment rates.

### Investing

-   Watchlist-to-decision conversion.
-   Order preview-to-confirmation conversion, where live trading is
    enabled.
-   Order failure and reconciliation rates.
-   Portfolio data freshness.
-   User-reported understanding and trust.

### Reputation and community

-   Percentage of ranked profiles with sufficient evidence.
-   Research helpfulness ratings with anti-abuse adjustment.
-   Thesis review completion.
-   Community election participation.
-   Repeat participation by unique eligible voters.
-   Dispute, moderation and fraud rates.

### \$WIF economy

-   Unique voters.
-   Valid votes and verified burn/transfer events, as applicable to the
    approved contract design.
-   Failed/reverted voting transactions.
-   Voting cost and completion rate.
-   Election concentration and whale influence.
-   Repeat voting participation.
-   No metric should reward unnecessary token destruction or excessive
    speculation.

### Trust and safety

-   Privacy incidents.
-   Unauthorized transaction incidents.
-   Extension permission complaints.
-   AI factual error reports.
-   Data deletion completion.
-   Security vulnerability remediation time.
-   Support resolution time.

------------------------------------------------------------------------

# 3. Users, personas and jobs to be done

## 3.1 Beginner investor

**Needs:** Plain-language explanations, clear risks, company basics, a
safe way to learn and no pressure to trade.

**Jobs:** - Understand what a company does. - Learn financial terms. -
Compare companies. - Save questions and research. - Build a watchlist
before investing.

## 3.2 Active retail investor

**Needs:** Efficient research, reliable data, portfolio context, thesis
tracking and useful peers.

**Jobs:** - Investigate a company quickly. - Compare financial
performance and valuation. - Record a thesis and invalidation
conditions. - Monitor a portfolio. - Review whether past reasoning was
correct.

## 3.3 Research-oriented contributor

**Needs:** A place to publish structured analysis, receive feedback and
establish credibility.

**Jobs:** - Publish sourced research. - Explain risks and
counterarguments. - Build a track record. - Receive quality-based
recognition. - Participate in community elections.

## 3.4 Social investor

**Needs:** Discover investors and ideas without blindly copying trades.

**Jobs:** - Follow public profiles. - Save a public thesis. - Compare
reasoning. - Follow a portfolio as read-only. - Independently decide
whether to act.

## 3.5 Creator, analyst or community organizer

**Needs:** Reach relevant users, run educational campaigns, collect
feedback and transparently sponsor activities.

**Jobs:** - Create a campaign. - Define eligibility and reward rules. -
Fund a disclosed reward pool. - Review valid submissions. - Publish
campaign outcomes.

## 3.6 Moderator and operations administrator

**Needs:** Moderation tools, audit trails, fraud signals, election
controls, campaign review and incident response.

------------------------------------------------------------------------

# 4. Product information architecture

## 4.1 Main web application navigation

-   Home / For You
-   Discover
-   Research
-   Watchlist
-   Portfolio
-   Social Feed
-   Communities
-   Leaderboard
-   Elections
-   Campaigns
-   Profile
-   Notifications
-   Settings
-   Help and disclosures

Navigation must be permission- and jurisdiction-aware. Trading,
elections and campaign features may be hidden or disabled where
unavailable.

## 4.2 Primary objects

-   User
-   Wallet/account
-   User preferences
-   Privacy and consent record
-   Extension installation/device
-   Company/entity
-   Tradable asset
-   Research session
-   Research brief
-   Source/citation
-   Watchlist
-   Investment thesis
-   Thesis revision
-   Portfolio
-   Portfolio snapshot
-   Order intent
-   Order
-   Fill/execution
-   Position
-   Transaction
-   Social post
-   Comment
-   Reaction
-   Follow relationship
-   Community
-   Membership
-   Reputation snapshot
-   Reputation evidence
-   Election
-   Candidate/nomination
-   Vote
-   Campaign
-   Campaign task/submission
-   Reward pool
-   Reward claim
-   Moderation report
-   Audit event

------------------------------------------------------------------------

# 5. End-to-end user journeys

## 5.1 Onboarding

1.  User visits Suiem.
2.  User reviews product purpose and jurisdiction availability.
3.  User creates an account through supported authentication.
4.  User accepts terms and privacy notice.
5.  User chooses whether to create/connect a wallet. Basic research must
    remain accessible without a funded wallet.
6.  If a wallet is created, explain custody model, recovery, transaction
    signing and risks.
7.  User chooses interests (technology, healthcare, energy, finance, AI,
    consumer, etc.).
8.  User selects experience level and research preferences.
9.  User optionally configures a watchlist.
10. User is offered the browser extension.
11. Extension permissions are explained individually; user can decline
    optional permissions.
12. User sees a clear privacy and pause tutorial.
13. User lands on a personalized but non-financially-prescriptive home
    feed.

**Acceptance criteria** - No wallet funding required to browse public
research. - No stock order or token transaction occurs during
onboarding. - No broad browsing permission is silently requested. - User
can skip interest selection and edit it later. - Consent records include
policy version and timestamp.

## 5.2 X/Twitter stock discovery flow

Example: user reads an X post discussing NVIDIA.

1.  Extension content script detects a supported page.
2.  Local entity recognition identifies a possible company mention.
3.  Context classifier distinguishes a real company reference from an
    unrelated word, joke, ticker collision or spam.
4.  Extension shows a small, dismissible notification only if confidence
    passes the configured threshold.
5.  Notification says which company was detected and why.
6.  User may open research, save for later, dismiss, mute the company or
    disable the extension.
7.  If user opens research, extension sends only the minimum necessary
    context after consent: entity identifier, selected public text or
    page excerpt if the user explicitly requests it, source URL and
    relevant metadata.
8.  Backend fetches permitted financial/news data and generates a cited
    research brief.
9.  User can ask follow-up questions, compare competitors, save a
    watchlist item or create a thesis.
10. User can publish selected research, but nothing is public by
    default.
11. User can choose to review a trading route if one is available and
    legally enabled.
12. Order preview shows instrument identity, token/security details,
    quote timestamp, amount, estimated quantity, fees, spread/slippage,
    route and risks.
13. User explicitly confirms and signs the order.
14. Transaction/order status is reconciled and displayed.
15. Later, the user can review the thesis and actual outcome.

**No passive browsing event may trigger a stock purchase.**

## 5.3 Daily research digest

1.  Extension stores minimal local activity summaries only when the user
    has enabled research detection and digest.
2.  The user can choose local-only, cloud-synced or no digest, depending
    on product support.
3.  Digest groups companies and topics the user intentionally engaged
    with.
4.  Each item includes why it appeared and links to source material.
5.  The digest separates:
    -   companies mentioned,
    -   research panels opened,
    -   briefs saved,
    -   theses created,
    -   watchlist changes,
    -   user-confirmed investment actions.
6.  The digest must not infer a user's investment intent from passive
    time alone.
7.  User can delete an item or all digest history.
8.  User can disable the digest independently from detection.

## 5.4 Thesis lifecycle

1.  User selects a company/asset.
2.  User creates a thesis with direction, horizon, rationale, supporting
    evidence, counterarguments, key risks and invalidation conditions.
3.  System captures timestamped source references and asset price
    context.
4.  User chooses private, followers-only or public visibility.
5.  User may revise thesis; previous versions remain timestamped for
    audit and scoring.
6.  System tracks relevant events and the chosen evaluation horizon.
7.  User reviews outcome and may explain what changed.
8.  Reputation calculation uses the frozen original thesis and objective
    evaluation rules, not a rewritten post-hoc thesis.

## 5.5 Social discovery

1.  User discovers a post, research brief or public profile.
2.  User can follow, bookmark, comment or provide structured feedback.
3.  User can see whether research is sourced, AI-assisted, sponsored or
    author-verified.
4.  User can follow a public portfolio in read-only mode.
5.  Any copying or mirrored trade must require a separate explicit
    authorization, suitability and legal review. It is not part of the
    default social flow.

## 5.6 Community election

1.  Election creator defines category, eligibility, start/end times,
    nomination rules, voting asset and reward details.
2.  Moderation/automated checks validate election configuration.
3.  Users review candidates and evidence.
4.  Eligible users connect a wallet and review the voting transaction.
5.  User approves the \$WIF voting transaction.
6.  Contract emits verifiable event(s).
7.  Indexer confirms the transaction and updates election state.
8.  Results are finalized after the voting window and required finality.
9.  Reward distribution follows disclosed, pre-funded rules.
10. Disputes and invalid-election procedures are available.

## 5.7 Extension privacy and control

Extension states:

-   **ON:** opted-in company detection and selected research features
    operate.
-   **PAUSED:** all detection and activity collection stop temporarily.
-   **OFF:** monitoring and collection stop until manually enabled.
-   **PRIVATE MODE:** user can exclude a tab, site or session; no
    activity from that context enters research history or digest.

Pause options: - 30 minutes - 1 hour - Until tomorrow - Custom
duration - Turn off until manually re-enabled

The OFF/PAUSED control must gate the actual content scripts, background
jobs, alarms, network requests and local event recording. Hiding a popup
is not sufficient.

------------------------------------------------------------------------

# 6. Suiem Intelligence --- browser extension requirements

## 6.1 Supported browsers and architecture

Initial target: Chromium-based browsers using Manifest V3. Browser
compatibility must be tested rather than assumed.

Recommended separation: - Background service worker: state, scheduling,
permissions and message routing. - Content script: local DOM context and
entity recognition. - Popup: quick status, pause and settings. - Side
panel: user-invoked research experience. - Options page: granular
privacy, site exclusions and digest preferences. - Shared package:
entity dictionary, schemas, permission state and validation.

## 6.2 Permission minimization

Request only the permissions needed for an explicit feature. Prefer
optional host permissions and user-triggered access over broad permanent
access.

Potential capabilities, subject to browser API review: - Storage for
preferences and local summaries. - Active tab access for user-invoked
context. - Context menu for "Research selected company". - Alarms only
for a user-enabled daily digest. - Scripting or host access only where
required and disclosed.

Do not request access to every website by default if the same experience
can be delivered through user-invoked access or optional host
permissions.

## 6.3 Company/entity detection

Detection inputs: - Company aliases. - Legal names. - Common names. -
Tickers and cashtags. - Exchange-qualified symbols. - Known
product/brand names only where unambiguous. - Context surrounding the
mention.

Detection output: - Canonical entity ID. - Candidate ticker(s). -
Confidence score. - Context category. - Evidence span. - Page domain. -
Detection timestamp. - Ambiguity reason, where applicable.

Rules: - A ticker may map to multiple securities across exchanges. -
Company names may be ordinary words. - Never assume a ticker uniquely
identifies a tradable instrument. - Distinguish company, product, fund,
index and cryptocurrency entities. - Do not display a buy action until a
specific supported instrument is resolved. - Low-confidence matches
should be silent or presented as "possible match", not an assertive
notification.

## 6.4 Notification behaviour

-   Small and dismissible.
-   No modal takeover.
-   Rate-limited per company and per domain.
-   User can mute a company, site or notification category.
-   Notification never places an order.
-   Clicking opens the side panel; dismissing records no investment
    intent.
-   No notifications while OFF, PAUSED or PRIVATE MODE.

## 6.5 Research side panel

Sections: 1. Company overview. 2. Business model and segments. 3.
Financial statements and trends. 4. Valuation metrics and methodology.
5. Industry and market context. 6. Competitor comparison. 7. Latest news
and events. 8. Risks and bear case. 9. Bull/base/bear scenarios with
assumptions. 10. Source list and data freshness. 11. User notes and
thesis creation. 12. Watchlist action. 13. Trading action only if a
supported instrument and legal permissions are available.

Every financial figure must show: - Currency and units. - Reporting
period. - Data provider/source. - Timestamp or as-of date. - Whether
reported, estimated or calculated. - Formula where derived.

## 6.6 Daily digest

Digest controls: - Enable/disable independently. - Delivery time and
timezone. - Local-only or account sync preference. - Companies/topics to
include/exclude. - Retention period. - Delete history. -
Email/push/in-app channel opt-in.

Digest content must be based on explicit research interactions or
approved local summaries, not a covert full browsing log.

## 6.7 Extension acceptance criteria

-   OFF and PAUSED stop all detection and network activity.
-   PRIVATE MODE excludes the selected context from history and digest.
-   A normal word or ambiguous ticker does not produce a false buy card.
-   Notification is non-blocking and rate-limited.
-   Highlighting text does not automatically send it to the backend.
-   Research request is user-triggered and clearly indicates what
    context will be shared.
-   No transaction can be initiated by a content script alone.
-   Extension can be uninstalled without breaking account data or wallet
    access.
-   Permission changes are reflected immediately.
-   Unit, integration and browser end-to-end tests cover all states.

------------------------------------------------------------------------

# 7. AI research and intelligence platform

## 7.1 Research engine capabilities

The AI research engine should provide: - Company/entity resolution. -
Company profile and business model. - Financial statement explanation. -
Revenue, margin, cash flow, debt and growth analysis. - Valuation metric
explanation. - Competitor comparison. - Industry and macro context. -
News summarization and event chronology. - Bull/base/bear scenario
construction. - Risk identification. - Thesis drafting assistance. -
Research question answering. - Daily digest generation.

## 7.2 Source-grounding policy

-   Use licensed or permitted financial data sources.
-   Store source metadata and retrieval timestamps.
-   Cite claims inline in the UI.
-   Separate facts from estimates, analysis and opinion.
-   If data is missing, stale or conflicting, say so.
-   Never invent financial metrics, filings, price targets or citations.
-   Do not claim an AI summary has verified a source unless the source
    was actually retrieved.
-   Record model/provider/version and prompt/template version for
    material generated research where appropriate.
-   Support user feedback and correction workflows.

## 7.3 AI output schema

A research brief should have structured fields:

``` json
{
  "entity": {
    "canonicalId": "string",
    "name": "string",
    "ticker": "string|null",
    "instrumentId": "string|null"
  },
  "summary": "string",
  "businessModel": [],
  "financialHighlights": [],
  "valuation": [],
  "recentDevelopments": [],
  "competitors": [],
  "bullCase": [],
  "bearCase": [],
  "risks": [],
  "openQuestions": [],
  "sources": [
    {
      "title": "string",
      "url": "string",
      "publisher": "string",
      "publishedAt": "ISO-8601|null",
      "retrievedAt": "ISO-8601",
      "supports": ["claim-id"]
    }
  ],
  "dataFreshness": "fresh|stale|partial|unknown",
  "disclaimer": "string"
}
```

This schema is illustrative; validate it with a versioned runtime
schema.

## 7.4 AI safety and reliability

-   Do not provide guaranteed outcomes or certainty language.
-   Do not turn sentiment into an automatic buy/sell signal.
-   Show risks and counterarguments alongside positive claims.
-   Avoid personalized recommendations unless the product is
    appropriately licensed and reviewed.
-   Explain uncertainty and missing data.
-   Detect prompt injection in retrieved web content; treat page text as
    untrusted data, never as instructions to the model or tool runtime.
-   Prevent model output from directly signing or executing
    transactions.
-   Any action that affects assets must pass deterministic policy checks
    and user authorization.
-   Keep AI research separate from execution services.

## 7.5 LangGraph/orchestration option

A graph-based workflow may coordinate: 1. Resolve entity. 2. Retrieve
approved data. 3. Retrieve news and filings. 4. Normalize financial
facts. 5. Compare competitors. 6. Generate structured analysis. 7.
Verify source coverage. 8. Produce cited report. 9. Store user-approved
research.

Do not introduce agentic autonomy where a deterministic workflow is
safer. Agents may gather and summarize; they may not independently
trade.

------------------------------------------------------------------------

# 8. Suiem Invest --- investing and portfolio requirements

## 8.1 Asset model

Suiem must distinguish: - Company/entity. - Underlying security. -
Tokenized security or tokenized exposure. - Fund/ETF. -
Cryptocurrency. - Simulated/demo instrument. - Unsupported instrument.

Each tradable instrument requires a verified instrument registry: -
Instrument ID. - Underlying identifier. - Symbol. - Issuer/provider. -
Legal instrument type. - Contract address, if tokenized. - Chain ID. -
Quote currency. - Decimals. - Venue/route. - Eligibility
jurisdictions. - Trading status. - Provider documentation. - Last
verification timestamp.

Never resolve a company mention directly to a token address without
checking this registry.

## 8.2 Research-to-order flow

1.  User chooses a verified instrument.
2.  User selects buy/sell only if permitted.
3.  User enters amount or quantity.
4.  System requests a live quote from an approved venue.
5.  UI displays quote timestamp, estimated execution, price impact,
    fees, spread and slippage.
6.  System validates limits, eligibility, balance, asset status and
    venue availability.
7.  User reviews order preview.
8.  User confirms via wallet/account authorization.
9.  Transaction/order is submitted.
10. System monitors pending, partially filled, filled, failed, expired
    or cancelled states.
11. Portfolio updates only from reconciled execution/fill data.
12. User receives a receipt with transaction/execution reference.

## 8.3 User consent and automation

Default: - No automatic stock buying. - No purchase based on scrolling
time. - No purchase based only on company detection. - No purchase based
only on an AI suggestion. - No trade from a social like, follow, vote or
copied portfolio.

Future optional automation may be considered only after legal/provider
review and a separate product approval. If introduced, it must have: -
Explicit setup and authorization. - Asset allowlist. - Per-order
limit. - Daily/weekly/monthly limit. - Total exposure limit. - Expiry. -
Clear status. - Re-authentication for material changes. - Immediate
revoke/pause. - Notifications and transaction history. - Policy
enforcement onchain or in a trusted execution boundary where
appropriate.

## 8.4 Portfolio

Portfolio features: - Positions and quantities. - Cost basis where
reliable. - Current value and price timestamp. - Realized/unrealized P&L
with methodology. - Asset allocation. - Historical performance. -
Deposits/withdrawals. - Order and transaction history. -
Dividends/distributions only if supported and verified. - Export. -
Privacy settings for each portfolio.

Do not combine simulated positions and real positions without a
persistent, highly visible label and separate accounting.

## 8.5 Watchlists and alerts

-   Add/remove instrument.
-   Notes and thesis link.
-   Price alert.
-   News/event alert.
-   Thesis invalidation alert.
-   Alert frequency and quiet hours.
-   No default alert spam.
-   Clear data source and timestamp.

## 8.6 Copy/follow portfolio

Initial version: - Follow investor. - View public allocation snapshot. -
View thesis and changes. - Save a portfolio. - Compare historical
results.

Not initially enabled: - Automatic mirroring. - Unattended copy
trading. - One-click copying that bypasses asset eligibility, risk
disclosure or order confirmation.

Any future execution-based copying requires separate legal, suitability,
consent, execution and risk design.

------------------------------------------------------------------------

# 9. Suiem Social

## 9.1 Feed types

-   Following.
-   Research discovery.
-   Trending companies.
-   Community highlights.
-   Educational content.
-   Campaigns.
-   Election results.

Ranking should prioritize relevance, quality, freshness and diversity.
Paid placements must be labeled and must not alter reputation
calculations.

## 9.2 Post types

-   Research brief.
-   Investment thesis.
-   Company discussion.
-   Portfolio snapshot.
-   Learning note.
-   Question.
-   Campaign submission.
-   Election nomination.

## 9.3 Social interactions

-   Follow/unfollow.
-   Like/helpful/not-helpful.
-   Comment/reply.
-   Bookmark.
-   Share.
-   Report.
-   Mute/block.
-   Community membership.

A like is not proof of research quality. Helpful votes should be
rate-limited and adjusted for suspicious patterns.

## 9.4 Profile privacy

Users control: - Public profile fields. - Portfolio visibility. -
Position-level visibility. - Transaction history visibility. - Thesis
visibility. - Research activity visibility. - Follower list
visibility. - Whether they appear in leaderboards.

Private by default for sensitive financial details. Public profile
should never reveal wallet-linked holdings without clear consent.

## 9.5 Moderation

Support: - Spam and scam detection. - Impersonation detection. - Market
manipulation reports. - Undisclosed sponsorship reports. - Harassment
and abuse reports. - Fraudulent performance claims. - AI-generated
content labels where applicable. - Appeals and audit trails.

------------------------------------------------------------------------

# 10. Suiem Reputation --- 50/50 scoring system

## 10.1 Score model

Suiem Score is a composite score out of 100:

`Suiem Score = 0.50 × Investor Performance Score + 0.50 × Community Contribution Score`

Both component scores are normalized to 0--100 before weighting.

The score is not a prediction of future returns and is not a financial
rating.

## 10.2 Investor Performance Score (50% of total)

Suggested internal component weights:

  Component                                   Weight within investor score
  ----------------------------------------- ------------------------------
  Risk-adjusted performance                                            40%
  Thesis outcome/accuracy                                              30%
  Consistency across evaluation periods                                20%
  Risk management and drawdown discipline                              10%

The final investor component is converted to 0--100.

Rules: - Use time-weighted and/or money-weighted return methodology
consistently and label it. - Include fees and cash flows where data
permits. - Use risk-adjusted measures only when sufficient history
exists. - Compare to a relevant benchmark and disclose benchmark
selection. - Avoid rewarding leverage or concentrated risk. - Do not
rank a user from a single lucky trade. - Include realized and unrealized
results with clear methodology. - Missing or unverifiable data must not
be treated as success. - Simulated results must never be presented as
live verified performance. - Require a minimum history and minimum
number of evaluated decisions before a profile becomes ranked. - New
users show "Building track record" rather than a misleading score.

## 10.3 Community Contribution Score (50% of total)

Suggested internal component weights:

  Component                                      Weight within contribution score
  -------------------------------------------- ----------------------------------
  Research quality and source quality                                         40%
  Helpful analysis and peer feedback                                          30%
  Educational contribution                                                    20%
  Constructive participation and consistency                                  10%

Quality signals: - Sources are relevant and accessible. - Claims are
supported. - Thesis includes risks/counterarguments. - Analysis is
original and useful. - Feedback is rated helpful by diverse, trusted
peers. - Contributions remain useful over time. - Spam, copied content
and engagement rings are penalized.

Do not award points for raw browsing minutes, number of generated AI
reports, number of posts, token holdings or paid votes.

## 10.4 Reputation integrity

-   Separate community popularity from measured score.
-   \$WIF voting does not directly change the Suiem Score.
-   Paid promotion does not improve score.
-   Sponsored research is labeled and evaluated separately.
-   AI-assisted content is allowed but must not be treated as proof of
    expertise.
-   Use anti-Sybil and collusion detection.
-   Apply rate limits and anomaly detection.
-   Store score snapshots and explain score changes.
-   Provide an appeal and correction process.
-   Publish methodology and version changes.
-   Recalculate only under versioned, auditable rules.

## 10.5 Profile display

Show: - Suiem Score and component breakdown. - Track-record maturity. -
Evaluation period. - Risk methodology. - Research contributions. -
Published theses. - Helpful feedback received. - Achievements. -
Community election wins. - Data verification status. - Simulated/live
status.

Do not show a single score without its methodology and
confidence/maturity context.

------------------------------------------------------------------------

# 11. Suiem Economy --- \$WIF and rewards

## 11.1 Economic design principles

-   \$WIF must have a clear product role.
-   Do not force \$WIF into research, basic onboarding or stock
    purchases.
-   Do not promise price appreciation, yield or guaranteed rewards.
-   Do not imply that holding \$WIF makes someone a better investor.
-   Keep voting and reputation separate.
-   Keep sponsor-funded rewards separate from token burns.
-   Disclose all election and reward rules before participation.
-   Verify token contract, decimals, chain and actual transfer/burn
    semantics before integration.

## 11.2 Proposed \$WIF utility

Primary use: community elections and recognition.

Potential flows: - Vote for a weekly research contributor. - Vote for a
community-selected spotlight. - Vote in curated community decisions. -
Participate in community challenges where the mechanic is clearly
defined.

The exact voting mechanic must be confirmed against the official \$WIF
token contract and the current World Is Fair voting design. Do not
assume that a token contract exposes a `burn()` method. If the approved
mechanism is transfer-to-burn-address, verify that the destination is
genuinely irrecoverable and documented. If a separate voting contract
handles the burn, verify its audited behaviour and event semantics.

## 11.3 Voting model

An initial proposed model is one eligible \$WIF unit equals one vote,
but this is not final until governance, contract semantics, whale
concentration, legal review and user research are complete.

Design questions to resolve: - Is voting open to all holders or only
eligible users? - Is there a per-wallet or per-election cap? - Is there
a snapshot or live-balance requirement? - Can users change votes? - Is a
vote refundable? (Default should be no if the token is irreversibly
burned.) - How are duplicate/Sybil accounts handled? - How are disputes
and invalid elections resolved? - How are election creators
authorized? - What happens if the contract or indexer is unavailable?

The UI must show the exact token amount, expected network fee,
irreversible nature (if applicable), election, candidate and transaction
destination before signing.

## 11.4 Election categories

-   Investor of the Week.
-   Research Contributor of the Week.
-   Best Educational Contribution.
-   Community Spotlight.
-   Community proposal/curation vote.

Avoid a single "best investor" competition that encourages reckless
short-term returns. Use a 50/50 award category that recognizes both
investor process/performance and contribution. A separate
contributor-only award can exist.

## 11.5 Rewards

Preferred reward asset: a supported stablecoin or other sponsor-funded
asset, subject to legal/provider approval.

Reward sources: - Explicit sponsor deposit. - Creator-funded campaign
budget. - Community treasury budget under disclosed governance rules.

Requirements: - Reward pool must be funded before the campaign/election
promises rewards. - Publish amount, eligibility, calculation, schedule
and claim window. - Escrow funds onchain where suitable. - Provide
refund rules for cancelled/invalid campaigns. - Prevent duplicate
claims. - Emit verifiable reward events. - Never fund guaranteed rewards
through speculative \$WIF appreciation. - Never describe a reward as
investment yield unless legally and technically accurate.

## 11.6 Campaigns

Campaign creators can: - Create campaign. - Define objective and
audience. - Submit sponsor budget. - Define tasks and evidence. - Set
eligibility. - Set start/end dates. - Publish terms and disclosures. -
Review submissions. - Approve/reject with reason. - Distribute reward. -
Publish final report.

Campaign participants can: - Discover. - Review sponsor and terms. -
Join. - Complete task. - Submit evidence. - Track review status. - Claim
approved reward. - Appeal a rejected submission.

------------------------------------------------------------------------

# 12. Smart contract requirements

All contracts must be designed against verified Robinhood Chain
documentation and the official token interfaces. Contract names below
are logical modules, not commitments to deploy separate contracts if a
simpler secure design is better.

## 12.1 Candidate modules

### ElectionManager

-   Create and configure elections.
-   Enforce start/end time.
-   Enforce eligibility and vote rules.
-   Prevent duplicate votes where required.
-   Finalize results.
-   Support cancellation/invalid-election procedures.
-   Emit complete events.

### WIFVoting

-   Verify official token address and chain.
-   Validate token amount and allowance/permit flow.
-   Execute the approved burn/transfer mechanism.
-   Associate vote with election and candidate.
-   Prevent replay and double-voting.
-   Emit vote and burn/transfer events.
-   Never hold arbitrary user assets beyond the approved flow.

### CampaignEscrow

-   Accept approved reward asset.
-   Record sponsor, campaign, budget and rules hash.
-   Release funds only under authorized conditions.
-   Support refunds on expiry/cancellation.
-   Prevent double claims.
-   Emit deposit, approval, claim and refund events.

### Optional PortfolioAttestation

Only if there is a clear privacy-preserving use case. Store hashes or
minimal attestations, never private holdings or full transaction details
beyond what is already public onchain.

## 12.2 Contract security

-   Reentrancy protection where relevant.
-   Checks-effects-interactions.
-   Access control with least privilege.
-   Pausable emergency controls with transparent governance.
-   Timelocked admin changes for material configuration.
-   No hidden upgrade authority.
-   Multisig for privileged roles.
-   Explicit ownership transfer procedures.
-   Integer/decimal correctness.
-   Replay protection.
-   Fuzz, invariant and stateful testing.
-   Fork tests against real dependencies.
-   Independent audit before mainnet value is at risk.
-   Verified source and deployment manifests.
-   Incident response and emergency communication plan.

## 12.3 Contract events

Events should include enough information for reliable indexing: -
ElectionCreated - CandidateAdded - VoteCast - VoteAssetBurned or
VoteAssetTransferredToSink (accurate name matching actual mechanism) -
ElectionFinalized - ElectionCancelled - CampaignCreated -
RewardDeposited - SubmissionApproved - RewardClaimed - CampaignRefunded

Never name an event `Burned` if the tokens were merely transferred to a
recoverable wallet.

------------------------------------------------------------------------

# 13. Backend and service architecture

## 13.1 Recommended approach

Start with a modular monolith and explicit domain boundaries. Split
services only when scaling, security isolation or operational needs
justify it.

Suggested domains: - Identity and access. - User profile and
preferences. - Extension event ingestion. - Entity and instrument
registry. - Research orchestration. - Financial data normalization. -
Watchlists and theses. - Portfolio and order orchestration. - Social
graph and feed. - Reputation calculation. - Elections and voting
index. - Campaign and rewards. - Notifications. - Moderation and
trust. - Admin and audit.

## 13.2 Suggested stack

This is a proposed stack; confirm after the repository audit: - Web:
Next.js + TypeScript. - Extension: Chrome Manifest V3 +
TypeScript/React. - Backend: Node.js + NestJS or an equivalent
structured TypeScript framework. - Database: PostgreSQL. - Cache/queues:
Redis + BullMQ or equivalent. - AI workflow: LangGraph or a
deterministic workflow engine where appropriate. - Contracts: Solidity +
Foundry. - Chain interaction: viem or ethers, selected consistently. -
Indexing: event indexer with reorg/finality handling. - Observability:
OpenTelemetry-compatible traces, metrics and logs. - Storage: encrypted
object storage for user-approved files. - API: versioned REST initially;
add GraphQL only if justified.

## 13.3 Service boundaries

### API gateway/application API

-   Authentication and authorization.
-   Rate limits.
-   Request validation.
-   Versioning.
-   Audit context.

### Research service

-   Retrieval.
-   Data normalization.
-   Model orchestration.
-   Citation validation.
-   Report persistence.

### Market data service

-   Provider adapters.
-   Quote freshness.
-   Instrument mapping.
-   Corporate action handling where applicable.
-   Provider failover.

### Order service

-   Instrument eligibility.
-   Quote/route.
-   Risk and limit checks.
-   User authorization.
-   Submission and reconciliation.
-   Idempotency.

### Chain indexer

-   Contract event ingestion.
-   Reorg/finality handling.
-   Event deduplication.
-   Contract version tracking.
-   Backfill and reconciliation.

### Reputation worker

-   Versioned score calculation.
-   Evidence ingestion.
-   Confidence/maturity checks.
-   Snapshot history.

### Notification service

-   User preferences.
-   Quiet hours.
-   Deduplication.
-   Delivery status.

------------------------------------------------------------------------

# 14. Data model --- initial logical schema

Use UUID/ULID identifiers internally. Store chain IDs and addresses as
normalized strings/byte values with validation. Monetary values must use
integer minor units or precise decimal/numeric types; never
floating-point arithmetic for balances or execution.

Core tables (names are illustrative):

## Identity

-   `users`
-   `user_auth_methods`
-   `wallet_accounts`
-   `user_preferences`
-   `consent_records`
-   `user_sessions`
-   `devices`
-   `extension_installations`

## Entity and market data

-   `entities`
-   `entity_aliases`
-   `instruments`
-   `instrument_contracts`
-   `market_venues`
-   `market_quotes`
-   `financial_facts`
-   `news_items`
-   `data_provider_records`

## Research

-   `research_sessions`
-   `research_events`
-   `research_briefs`
-   `research_brief_sources`
-   `research_questions`
-   `research_notes`
-   `daily_digests`

## Investing

-   `watchlists`
-   `watchlist_items`
-   `investment_theses`
-   `thesis_versions`
-   `thesis_evaluations`
-   `orders`
-   `order_events`
-   `fills`
-   `portfolio_snapshots`
-   `positions`
-   `ledger_entries`

## Social

-   `profiles`
-   `follows`
-   `posts`
-   `post_sources`
-   `comments`
-   `reactions`
-   `bookmarks`
-   `communities`
-   `community_memberships`
-   `moderation_reports`

## Reputation

-   `reputation_evidence`
-   `reputation_scores`
-   `reputation_score_components`
-   `reputation_snapshots`
-   `reputation_appeals`
-   `achievement_awards`

## Economy

-   `elections`
-   `election_candidates`
-   `election_votes`
-   `chain_transactions`
-   `indexed_chain_events`
-   `campaigns`
-   `campaign_submissions`
-   `reward_pools`
-   `reward_claims`

## Operations

-   `audit_logs`
-   `idempotency_keys`
-   `outbox_events`
-   `webhook_deliveries`
-   `feature_flags`
-   `provider_health`
-   `admin_actions`

### Data integrity requirements

-   Foreign keys for relational integrity.
-   Unique constraints for idempotency and duplicate votes.
-   Append-only or immutable event history for financial and scoring
    evidence.
-   Explicit soft-delete/anonymization strategy.
-   Row-level security where appropriate.
-   Tenant/user scoping in all queries.
-   Versioned schema migrations.
-   Retention and deletion jobs.
-   No secrets or private keys in database logs.

------------------------------------------------------------------------

# 15. API design --- initial endpoint catalogue

All APIs require versioning, authentication where applicable, schema
validation, authorization, rate limiting, idempotency for writes and
structured error responses.

Example prefix: `/api/v1`.

## Identity

-   `POST /auth/register`
-   `POST /auth/login`
-   `POST /auth/logout`
-   `GET /me`
-   `PATCH /me`
-   `GET /me/consents`
-   `POST /me/consents`
-   `POST /wallet/link`
-   `DELETE /wallet/link/:id`

## Extension

-   `GET /extension/config`
-   `POST /extension/installations`
-   `PATCH /extension/preferences`
-   `POST /extension/research-context`
-   `POST /extension/digest/preview`
-   `GET /extension/digest`
-   `DELETE /extension/activity`
-   `POST /extension/telemetry` (strictly minimized and opt-in)

The extension must never submit an order endpoint directly from a
content script.

## Entities and instruments

-   `GET /entities/search`
-   `GET /entities/:id`
-   `GET /entities/:id/instruments`
-   `GET /instruments/:id`
-   `GET /instruments/:id/quote`
-   `GET /instruments/:id/news`

## Research

-   `POST /research/briefs`
-   `GET /research/briefs/:id`
-   `POST /research/briefs/:id/questions`
-   `POST /research/briefs/:id/feedback`
-   `POST /research/compare`
-   `POST /research/theses/draft`

## Watchlists and theses

-   `GET /watchlists`
-   `POST /watchlists`
-   `POST /watchlists/:id/items`
-   `DELETE /watchlists/:id/items/:itemId`
-   `POST /theses`
-   `GET /theses/:id`
-   `PATCH /theses/:id`
-   `POST /theses/:id/publish`
-   `POST /theses/:id/review`

## Portfolio and orders

-   `GET /portfolio`
-   `GET /portfolio/history`
-   `GET /portfolio/transactions`
-   `POST /orders/preview`
-   `POST /orders`
-   `GET /orders/:id`
-   `POST /orders/:id/cancel` (only if supported by venue)
-   `GET /orders/:id/events`

Order endpoints must enforce idempotency, jurisdiction, instrument
status, balance, limit checks and explicit user authorization.

## Social

-   `GET /feed`
-   `POST /posts`
-   `GET /posts/:id`
-   `POST /posts/:id/comments`
-   `POST /posts/:id/reactions`
-   `POST /users/:id/follow`
-   `DELETE /users/:id/follow`
-   `GET /profiles/:id`
-   `GET /profiles/:id/research`
-   `GET /profiles/:id/portfolio` (only if public and permitted)

## Reputation

-   `GET /profiles/:id/reputation`
-   `GET /leaderboards`
-   `GET /reputation/methodology`
-   `POST /reputation/appeals`

## Elections and campaigns

-   `GET /elections`
-   `POST /elections`
-   `GET /elections/:id`
-   `POST /elections/:id/nominations`
-   `POST /elections/:id/vote-intent`
-   `GET /elections/:id/results`
-   `GET /campaigns`
-   `POST /campaigns`
-   `POST /campaigns/:id/submissions`
-   `POST /campaigns/:id/submissions/:submissionId/review`
-   `POST /campaigns/:id/rewards/claim`

The backend may prepare unsigned transaction data, but wallet signing
must remain in the approved client/account infrastructure with explicit
user consent.

------------------------------------------------------------------------

# 16. Security, privacy and trust

## 16.1 Threat model

Threats include: - Account takeover. - Wallet compromise. - Malicious
browser extension updates. - Content-script injection. - Prompt
injection through web content. - Malicious or stale financial data. -
Fake stock/token instruments. - Transaction substitution. - Phishing and
fake token contracts. - Replay/double submission. - Indexer reorg or
event duplication. - Reputation manipulation. - Sybil voting. - Wash
trading or fake performance. - Sponsor/reward fraud. - Insider/admin
abuse. - Data leakage across users. - Insecure API keys. -
Dependency/supply-chain compromise.

## 16.2 Security requirements

-   Strong authentication and session management.
-   MFA/passkeys where supported.
-   Wallet recovery model explained and tested.
-   Private keys never reach application backend.
-   Hardware-backed or managed key protection where supported.
-   Least-privilege wallet/session permissions.
-   Spending limits enforced independently of UI.
-   Transaction simulation and human-readable transaction details.
-   Contract/address allowlists.
-   Domain and phishing protection.
-   CSP and extension content security policy.
-   Input/output validation.
-   CSRF protection where applicable.
-   Rate limits and abuse controls.
-   Secret management.
-   Dependency scanning and lockfile review.
-   Secure CI/CD.
-   Signed releases and controlled extension publication.
-   Audit logs for admin and financial actions.
-   Incident response playbooks.
-   External smart contract audit before mainnet value.
-   Penetration test before production launch.

## 16.3 Privacy requirements

-   Data minimization.
-   Local-first company detection where feasible.
-   No raw browsing history upload by default.
-   No browsing collection while OFF/PAUSED/PRIVATE MODE.
-   Explicit opt-in for digest sync.
-   User-visible data inventory.
-   Retention settings.
-   Export and deletion workflows.
-   Encryption in transit and at rest.
-   No sale of personal browsing data.
-   No use of private financial data for ad targeting.
-   No private data onchain.
-   Third-party AI/data provider disclosure.

## 16.4 User rights

Provide: - Access/download of personal data. - Correction. - Deletion
where legally permitted. - Consent withdrawal. - Extension data clear. -
Account closure. - Appeal of moderation/reputation actions. - Support
contact and incident reporting.

------------------------------------------------------------------------

# 17. Legal, regulatory and jurisdiction gating

This section is a product requirement, not legal advice. Obtain
qualified legal counsel in every target jurisdiction before enabling
securities-related features.

Review: - Whether the product is a broker, adviser, exchange, investment
research publisher, financial promotion service or other regulated
activity. - Whether tokenized assets are securities, derivatives, debt
instruments or other regulated products. - Whether Suiem may route,
arrange, execute or custody orders. - Whether copy-trading or
personalized recommendations create additional obligations. -
KYC/AML/sanctions obligations for wallets, rewards and trading
partners. - Consumer protection and risk disclosure. - Data protection
and browser tracking laws. - Marketing, referral and influencer
disclosure. - Tax reporting obligations. - Stablecoin/payment
regulation. - Cross-border access and geofencing. - Record retention and
complaint handling.

### India-specific launch gate

The product owner is based in India. Before offering live
securities/tokenized-equity trading, obtain specialist Indian legal
advice on applicable securities, foreign investment, exchange-control,
tax, advertising and digital asset requirements. Do not assume a
tokenized US equity product can be offered to Indian residents merely
because it is available on an EVM chain.

Until approved: - Disable live trading for unsupported jurisdictions. -
Offer research and educational features with appropriate disclaimers. -
Use clearly marked simulation/test assets. - Do not accept customer
funds for securities trading. - Do not market simulated returns as
actual investment performance.

### Jurisdiction enforcement

Use a server-side eligibility policy and provider-level checks.
Client-side hiding alone is insufficient. Log policy version and
decision reason without collecting unnecessary sensitive data.

------------------------------------------------------------------------

# 18. Reliability, scalability and operations

## 18.1 Availability objectives

Proposed initial SLOs, to be revised after traffic modelling: - Core
read APIs: 99.9% monthly availability. - Research job acceptance: 99.5%
monthly availability. - Order state reconciliation: 99.9% of accepted
orders reconciled within defined provider SLA. - Chain event indexing:
recoverable from source chain and backfillable. - No silent loss of
confirmed transaction events.

## 18.2 Observability

Track: - API latency and error rate. - Queue depth and job age. - AI
provider latency/cost/error. - Market data freshness. - Quote and
execution discrepancies. - Order state transitions. - RPC/indexer
health. - Reorgs and backfills. - Contract event ingestion lag. -
Extension error rates. - Notification delivery. - Reputation calculation
failures. - Election state inconsistencies.

Do not log raw browsing content, wallet secrets, private keys or
unnecessary personal financial information.

## 18.3 Backups and disaster recovery

-   Automated encrypted database backups.
-   Point-in-time recovery.
-   Restore drills.
-   Object storage versioning.
-   Infrastructure-as-code.
-   Key rotation procedures.
-   RPC/provider failover.
-   Chain indexer full rescan capability.
-   Incident communication process.
-   RPO/RTO targets agreed before production.

------------------------------------------------------------------------

# 19. Testing and quality strategy

## 19.1 Unit tests

-   Entity/ticker resolution.
-   Score formulas.
-   Financial calculations.
-   Consent state machine.
-   Extension state transitions.
-   API validation.
-   Order limit checks.
-   Reward eligibility.
-   Vote calculations.

## 19.2 Integration tests

-   Extension to API.
-   API to research provider.
-   Research source citation.
-   Wallet connection.
-   Quote-to-order preview.
-   Order reconciliation.
-   Chain event indexing.
-   Election creation/voting/finalization.
-   Reward escrow/claim/refund.

## 19.3 Smart contract tests

-   Unit tests.
-   Fuzz tests.
-   Invariant tests.
-   Access control.
-   Reentrancy and callback cases.
-   Duplicate/replay attempts.
-   Invalid election states.
-   Boundary timestamps.
-   Decimal/precision cases.
-   Emergency pause.
-   Upgrade/admin controls if any.
-   Fork tests against verified dependencies.

## 19.4 End-to-end tests

1.  User signs up without connecting a wallet.
2.  User installs extension and declines optional permissions.
3.  User enables detection.
4.  User visits a test page with an unambiguous company mention.
5.  Notification appears once.
6.  User opens research.
7.  User saves a brief and creates a thesis.
8.  User disables extension.
9.  Confirm no detection/network activity continues.
10. User creates public post.
11. Another user follows and comments.
12. Reputation updates from valid evidence.
13. Election is created and funded/configured.
14. User reviews and signs a test \$WIF vote.
15. Event indexer updates results.
16. Election finalizes and reward is claimed in test environment.

## 19.5 Financial correctness tests

-   No floating point for money.
-   Exact decimal conversion.
-   Quote expiry.
-   Slippage bounds.
-   Partial fills.
-   Duplicate callbacks.
-   Failed transactions.
-   Chain reorg.
-   Reconciliation against provider and chain.
-   Portfolio cost-basis methodology.
-   Simulated/live separation.

------------------------------------------------------------------------

# 20. Design and experience requirements

## 20.1 Brand direction

Brand: **Suiem**

Suggested tagline: **Your attention. Your investments. Your influence.**

Visual direction: - Premium, calm fintech. - Dark navy as a possible
primary theme with accessible light mode. - Restrained green for
positive/confirmed states. - Avoid casino-like animations, flashing
prices and gamified pressure. - Clear typography and data hierarchy. -
Mobile-responsive web experience. - Consistent extension and web design
system.

## 20.2 UX rules

-   Research before trading.
-   No surprise orders.
-   No misleading "guaranteed" or "risk-free" language.
-   Every price shows timestamp.
-   Every financial metric shows source and period.
-   Every AI claim links to evidence.
-   Every transaction shows asset, amount, fees and destination.
-   Simulated assets are always labelled.
-   Irreversible actions require explicit confirmation.
-   Privacy controls are always easy to find.
-   Users can use research without joining elections or holding \$WIF.

## 20.3 Accessibility

-   Keyboard navigation.
-   Screen-reader labels.
-   Sufficient color contrast.
-   Do not use color alone for gain/loss or status.
-   Reduced-motion support.
-   Responsive layouts.
-   Clear error and loading states.
-   Accessible charts and data tables.

------------------------------------------------------------------------

# 21. Monetization and business model

Potential revenue streams, subject to legal review: - Premium research
subscription. - Advanced portfolio analytics. - Creator/campaign
tools. - Sponsored research/campaign placement with clear labels. - B2B
analytics or API access. - Partner referral revenue only where permitted
and disclosed.

Avoid: - Hidden execution markups. - Pay-to-win reputation. - Selling
browsing histories. - Undisclosed sponsored rankings. - Reward promises
tied to \$WIF price. - Incentives that encourage unnecessary trading.

All fees must be disclosed before the user incurs them.

------------------------------------------------------------------------

# 22. Admin and operations console

Admin capabilities: - User support lookup with least privilege. -
Account restriction and appeals. - Content moderation. - Campaign
review. - Election configuration review. - Contract and chain status. -
Provider health. - Market data freshness. - Order reconciliation
dashboard. - Reputation recalculation and audit. - Feature flags by
jurisdiction. - Incident controls. - Audit log search.

Privileged actions require: - Role-based access. - MFA. - Reason code. -
Immutable audit record. - Approval workflow for sensitive operations. -
Separation of duties for treasury/reward operations.

------------------------------------------------------------------------

# 23. Rollout plan --- full product, not a hackathon MVP

Build the complete product in dependency-ordered releases. The sequence
controls risk; it does not reduce the long-term scope.

## Release 0 --- Discovery and reference audit

-   Clone Banchor.
-   Inspect all source and tests.
-   Document reusable modules.
-   Verify Robinhood Chain and \$WIF integration facts.
-   Select data, wallet and trading providers.
-   Complete legal and threat-model discovery.
-   Write ADRs and implementation plan.

**Exit:** Approved architecture and no unresolved critical assumptions
hidden in code.

## Release 1 --- Platform foundation

-   Monorepo and CI.
-   Authentication.
-   User/profile model.
-   Database migrations.
-   Wallet abstraction.
-   Consent and privacy service.
-   Feature flags.
-   Observability.
-   Admin foundations.

**Exit:** Secure account foundation, migration strategy and baseline
tests.

## Release 2 --- Suiem Intelligence

-   Extension popup and options.
-   ON/PAUSED/OFF/PRIVATE MODE.
-   Local company detection.
-   Contextual notification.
-   User-invoked research side panel.
-   AI research with citations.
-   Daily digest.
-   Data export/deletion.

**Exit:** Complete privacy-tested extension and research journey.

## Release 3 --- Research and investing foundation

-   Entity/instrument registry.
-   Financial data adapters.
-   Research workspace.
-   Watchlists.
-   Investment thesis lifecycle.
-   Simulated portfolio.
-   Live trading adapter behind jurisdiction and provider gates.

**Exit:** Correct, tested research and portfolio accounting; live
trading remains disabled until all gates pass.

## Release 4 --- Social network

-   Feed.
-   Profiles.
-   Following.
-   Research publishing.
-   Comments and feedback.
-   Communities.
-   Portfolio visibility controls.

**Exit:** Safe social publishing, moderation and privacy.

## Release 5 --- Reputation

-   Investor performance methodology.
-   Contributor quality methodology.
-   Evidence ingestion.
-   Maturity thresholds.
-   Score snapshots.
-   Appeals.
-   Leaderboards.

**Exit:** Reproducible scores, clear methodology and anti-manipulation
tests.

## Release 6 --- \$WIF economy

-   Verify official token and chain details.
-   Integrate approved voting mechanism.
-   Election lifecycle.
-   Onchain event indexing.
-   Election results.
-   Sponsor-funded reward escrow.
-   Campaign workflows.

**Exit:** Audited contracts, correct burn/transfer semantics and
reproducible onchain results.

## Release 7 --- Production readiness

-   External audits.
-   Penetration testing.
-   Load tests.
-   Legal sign-off.
-   Provider agreements.
-   Support processes.
-   Backup/restore drills.
-   Incident simulations.
-   Controlled beta.
-   Public launch.

**Exit:** Product, legal, security, reliability and support owners sign
off.

------------------------------------------------------------------------

# 24. Definition of Done

A feature is not complete because it renders in the browser.

Every feature must include: - Product acceptance criteria. - Design
states (loading, empty, success, error, disabled). - Authorization
checks. - Input validation. - Data retention/privacy treatment. - Unit
and integration tests. - E2E test where user-critical. - Logging/metrics
without sensitive data. - Accessibility review. - Documentation. - Error
handling and recovery. - Security review proportional to risk. - Feature
flag/rollback plan. - Product owner acceptance.

Financial and onchain features additionally require: - Decimal-safe
calculations. - Idempotency. - Transaction simulation where available. -
Clear user confirmation. - Reconciliation. - Contract tests. -
Deployment manifest. - Audit/security review. -
Legal/provider/jurisdiction approval.

------------------------------------------------------------------------

# 25. Open decisions and assumptions register

Claude Code must not silently resolve these. Create an ADR for each.

  -----------------------------------------------------------------------
  ID                Decision          Current direction Required
                                                        verification
  ----------------- ----------------- ----------------- -----------------
  D-01              Robinhood Chain   Target chain      Official chain
                    configuration                       ID, RPC,
                                                        explorer,
                                                        finality and gas

  D-02              \$WIF token       Community voting  Official
                                      utility           contract,
                                                        decimals,
                                                        transfer/burn
                                                        semantics,
                                                        official
                                                        documentation

  D-03              Voting design     Proposed          Whale resistance,
                                      token-weighted    caps, snapshot,
                                      vote              eligibility,
                                                        irreversible
                                                        action and legal
                                                        review

  D-04              Stock token venue Adapter-based     Supported
                                      integration       instruments, real
                                                        liquidity, venue
                                                        contracts, order
                                                        APIs and
                                                        eligibility

  D-05              Financial data    Provider adapters Licensing,
                                                        coverage,
                                                        latency, cost and
                                                        permitted display

  D-06              Wallet            Passkey +         Supported smart
                                      external wallet   account stack,
                                      support           recovery, session
                                                        keys and chain
                                                        support

  D-07              AI providers      Model-agnostic    Data terms,
                                      orchestration     retention, cost,
                                                        reliability and
                                                        region

  D-08              India             Research-first    Qualified legal
                    availability      until cleared     review and
                                                        partner
                                                        eligibility

  D-09              Reputation        Versioned 50/50   Methodology,
                    benchmark         score             minimum history,
                                                        manipulation and
                                                        fairness

  D-10              Social portfolio  Private by        Consent and
                    visibility        default           onchain/public
                                                        data implications

  D-11              Mobile app        Responsive web    Native app need,
                                      first             distribution and
                                                        maintenance

  D-12              Sponsored rewards Prefunded         Asset support,
                                      stablecoin pool   escrow, tax and
                                                        legal treatment
  -----------------------------------------------------------------------

------------------------------------------------------------------------

# 26. Immediate instructions for the first Claude Code session

Claude Code should begin with **read-only discovery**, not a large code
generation task.

Use this prompt after placing this PRD at the root as `PRD.md`:

``` text
You are the staff engineer and technical architect for Suiem.

First read the root PRD.md completely. Then clone or inspect the reference repository:
https://github.com/soumyacodes007/banchor

Do not start implementing features yet.

1. Inspect the full repository tree, README, docs/PRD.md, backend, contracts, extension, web, screenshots, package manifests, tests and deployment scripts.
2. Identify the exact current architecture, dependencies, chain assumptions, wallet/session-key implementation, contract interfaces, mock assets, API endpoints, privacy behaviour and test coverage.
3. Separate reusable code from demo-only or unsafe code.
4. Verify every chain-specific assumption against current official Robinhood Chain documentation. Do not invent addresses or integrations.
5. Verify the official $WIF token details and actual voting/burn mechanism from authoritative sources.
6. Identify the current limitations of Banchor's mock stock venue and explain what would be needed for genuine tokenized-stock execution.
7. Compare the repository against every section of Suiem PRD.md.
8. Produce:
   - docs/REPO_AUDIT.md
   - docs/TECHNICAL_GAP_ANALYSIS.md
   - docs/ARCHITECTURE.md
   - docs/IMPLEMENTATION_PLAN.md
   - docs/ADR/0001-product-boundaries.md
   - docs/ADR/0002-chain-and-wallet.md
   - docs/ADR/0003-data-and-privacy.md
   - docs/ADR/0004-investment-execution.md
   - docs/ADR/0005-reputation-and-voting.md
9. Include diagrams, data flows, trust boundaries, threat assumptions and dependency ordering.
10. List every unknown that needs product-owner, provider, legal or security confirmation.

Do not:
- deploy contracts;
- send transactions;
- use real funds;
- claim mock assets are real securities;
- expose secrets;
- enable automatic stock buying;
- change the existing source before the audit is reviewed.

Finish with a concise executive summary and a proposed first implementation milestone. Wait for approval before making broad code changes.
```

------------------------------------------------------------------------

# 27. Reference links

## Source code and reference product

-   Banchor repository: https://github.com/soumyacodes007/banchor
-   Banchor original README:
    https://github.com/soumyacodes007/banchor#readme
-   Banchor reference PRD:
    https://github.com/soumyacodes007/banchor/blob/main/docs/PRD.md
-   Banchor backend reference:
    https://github.com/soumyacodes007/banchor/tree/main/backend
-   Banchor contracts reference:
    https://github.com/soumyacodes007/banchor/tree/main/contracts
-   Banchor extension reference:
    https://github.com/soumyacodes007/banchor/tree/main/extension
-   Banchor web reference:
    https://github.com/soumyacodes007/banchor/tree/main/web
-   Banchor screenshots:
    https://github.com/soumyacodes007/banchor/tree/main/screenshots

## Platform verification

-   Robinhood Chain official documentation:
    https://docs.robinhood.com/chain/
-   Robinhood Chain official website: https://robinhoodchain.com/
-   Solidity documentation: https://docs.soliditylang.org/
-   Foundry documentation: https://book.getfoundry.sh/
-   Chrome Extensions documentation:
    https://developer.chrome.com/docs/extensions/
-   LangGraph documentation:
    https://docs.langchain.com/oss/javascript/langgraph/overview

**Important:** These are starting points for verification. Claude Code
must confirm current documentation, supported networks and integrations
before implementation.

------------------------------------------------------------------------

# Appendix A --- Product decisions already agreed

1.  Product name is **Suiem**.
2.  Suiem is intended as a complete company-grade product, not a reduced
    hackathon-only MVP.
3.  Banchor is the reference implementation and must be inspected before
    coding.
4.  The browser extension uses the **A + C** interaction model:
    -   A: contextual notification appears when a relevant company is
        detected; research opens only when the user clicks.
    -   C: a daily research digest summarizes intentional research
        activity.
5.  Extension must have a prominent ON/OFF control, PAUSE options and
    Private Mode/site exclusions.
6.  OFF/PAUSED must stop underlying detection and activity collection,
    not merely hide the UI.
7.  The extension must not automatically buy stock because a user
    scrolls, watches content or visits a website.
8.  Stock buying remains part of the product. It is user-reviewed and
    user-confirmed by default.
9.  AI research covers company overview, financials, valuation, news,
    competitors, risks and thesis support with sources.
10. User profiles use a proposed 50/50 structure:
    -   50% Investor Performance.
    -   50% Community Contribution.
11. Community voting and reputation scoring are separate. Votes do not
    directly inflate the Suiem Score.
12. \$WIF is intended for community voting/elections and defined
    community participation, not forced into basic research or stock
    purchases.
13. Stablecoin/sponsor-funded rewards are separate from \$WIF and must
    be prefunded and transparently disclosed.
14. Social portfolio following is read-only by default; copying trades
    is not automatic.
15. Privacy, legal eligibility, asset authenticity, security and
    financial correctness are core requirements.

# Appendix B --- Product acceptance summary

Suiem is directionally complete when a user can:

1.  Create an account without being forced to fund a wallet.
2.  Install and control the extension.
3.  Browse normally with extension OFF or Private Mode.
4.  Detect a company on X without an automatic trade.
5.  Open a sourced AI research panel on demand.
6.  Save a research brief and create a thesis.
7.  Receive a daily digest based on opted-in research activity.
8.  Add an instrument to a watchlist.
9.  Review a simulated portfolio or, where legally/provider-approved, a
    real portfolio.
10. Submit a user-confirmed order only through a verified supported
    venue.
11. Publish research and control its visibility.
12. Follow investors and view public portfolio snapshots.
13. Build an explainable 50/50 reputation score with sufficient
    evidence.
14. Participate in a verifiable \$WIF election after reviewing the
    transaction.
15. See election results and any prefunded reward status.
16. Export or delete personal data and revoke extension permissions.

**End of PRD.**
