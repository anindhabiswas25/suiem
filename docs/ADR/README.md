# Architecture Decision Records

Format: Context → Decision → Consequences → Open items. Statuses are `Proposed`, `Accepted`, `Superseded`. All Phase 1 ADRs are **Proposed** until the product owner approves them.

| ADR | Title | Status |
| --- | --- | --- |
| [0001](0001-product-boundaries.md) | Product boundaries and forbidden behaviours | Proposed |
| [0002](0002-chain-and-wallet.md) | Chain configuration and wallet model | Proposed |
| [0003](0003-data-and-privacy.md) | Data, privacy, financial data providers and portfolio visibility | Proposed |
| [0004](0004-investment-execution.md) | Investment execution and venue adapters | Proposed |
| [0005](0005-reputation-and-voting.md) | Reputation score and $WIF voting | Proposed |
| [0006](0006-ai-providers-and-research.md) | AI providers and research orchestration | Proposed |
| [0007](0007-mobile-strategy.md) | Mobile strategy | Proposed |
| [0008](0008-sponsored-rewards.md) | Sponsored rewards and campaign escrow | Proposed |
| [0009](0009-monorepo-and-stack.md) | Monorepo layout and technology stack | Proposed |

## PRD §25 decision traceability

| ID | Decision | ADR | Current status | Blocking question |
| --- | --- | --- | --- | --- |
| D-01 | Robinhood Chain configuration | 0002 §1 | Core facts VERIFIED (46630, RPC, explorer, ETH, Nitro, finality stages) | OQ-PR-03 (RPC provider plan) |
| D-02 | $WIF token | 0005 §2 | **UNVERIFIED.** TestWIF on testnet | OQ-P-01, OQ-P-02 |
| D-03 | Voting design | 0005 §3 | Proposed defaults, needs PO + legal | OQ-P-04, OQ-L-06 |
| D-04 | Stock token venue | 0004 | Adapter-based. Simulated venue only. Testnet venue UNVERIFIED | OQ-P-03, OQ-PR-04 |
| D-05 | Financial data | 0003 §3 | Provider TBD | OQ-PR-01 |
| D-06 | Wallet | 0002 §2 | ERC-4337 smart account + external wallets. Testnet AA infra UNVERIFIED | OQ-PR-05 |
| D-07 | AI providers | 0006 | Model-agnostic. Provider TBD | OQ-PR-02 |
| D-08 | India availability | 0001 §4 | Research-first. Trading off everywhere | OQ-L-01, OQ-L-02 |
| D-09 | Reputation benchmark | 0005 §1 | Methodology v1 proposed | OQ-P-07, OQ-L-05 |
| D-10 | Social portfolio visibility | 0003 §4 | Private by default, per-field | OQ-P-08 |
| D-11 | Mobile app | 0007 | Responsive web + PWA. Native deferred | OQ-P-09 |
| D-12 | Sponsored rewards | 0008 | Prefunded escrow, test stablecoin on testnet | OQ-P-10, OQ-L-06 |
