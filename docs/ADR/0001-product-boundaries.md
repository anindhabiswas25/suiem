# ADR-0001: Product boundaries and forbidden behaviours

- Status: Proposed · Date: 2026-11-10 · Covers: PRD §1.2, §2.2, §8.3, §17, Appendix A; **D-08**

## Context

Banchor, the reference implementation, is built on attention → purchase loops (scroll dividends, highlight-to-buy, detox buys, nudges, copy basket, AI buy picks). The Suiem PRD keeps stock buying in the product but forbids every passive or automatic trigger. The product owner is based in India, and Robinhood Stock Tokens are tokenised debt securities with jurisdiction restrictions (VERIFIED_FACTS S-02, S-04). Suiem targets Robinhood Chain **testnet only** for all eight phases.

## Decision

1. **Testnet only.** Every chain config, deployment and feature targets chain 46630. Chain 4663 (mainnet) is absent from config, and the API refuses any other chain ID. Leaving testnet needs a new ADR and PO, legal and security sign-off.
2. **No asset movement without an explicit, per-action user confirmation** in the web app's wallet UI. There are no standing session keys, no delegated signers, no auto top-up, no scheduled orders and no gasless "silent" buys.
3. **Forbidden triggers.** None of these may ever create an order, intent, transaction or pre-filled buy: browsing time, scrolling, video watching, site visits, company detection, text highlighting, notifications, AI output, likes, follows, votes, viewing or saving someone else's portfolio. This is enforced structurally: the extension has no order or wallet code, and the research worker has no execution credentials.
4. **Dropped Banchor features.** Scroll dividends, highlight-to-buy cards, detox auto-buys, buy nudges, Live mode, one-tap copy basket, gift buys, roast shaming, transaction-count vanity metrics and AI "picks" with amounts are all dropped. See REPO_AUDIT §5.
5. **Jurisdiction (D-08).** Research, education, watchlists, theses, social, reputation and simulated portfolios are available. **Live trading is disabled for every jurisdiction**, including India, until legal, provider and asset-eligibility reviews pass. Testnet-token features show "no value, not a security". A server-side eligibility policy (versioned and logged) gates every trading-adjacent endpoint. Client hiding is cosmetic only.
6. **Representation.** Simulated and test assets are never called shares, stocks you own, securities or investments. Every surface carries a `SIMULATED` or `TESTNET TOKEN` badge. No x-suffixed lookalike tickers.
7. **$WIF stays bounded.** It is not required for research, onboarding or any purchase, and has no effect on the Suiem Score.

## Consequences

- Banchor's growth mechanics are gone. Activation relies on research value (WARC north star).
- Every PR that touches money, chain or the extension carries a checklist item: "introduces no forbidden trigger".
- Future automation (PRD §8.3) needs a separate ADR, legal review and its own limits design. It is not on the roadmap.

## Open items

OQ-L-01 (India legal scope for research publishing and simulated trading), OQ-L-02 (Stock Token eligibility for Indian residents), OQ-L-07 (testnet beta terms).
