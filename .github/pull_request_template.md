## What & why

<!-- Link the epic (e.g. E2.3) and the PRD/ADR sections this implements. -->

## Definition of Done (PRD §24)

- [ ] Product acceptance criteria met (list them and the tests that prove them)
- [ ] Design states: loading · empty · success · error · disabled
- [ ] Authorization checks (server-side) with tests
- [ ] Input validation (Zod schemas in `packages/shared`)
- [ ] Data retention / privacy treatment (ADR-0003). No new PII in logs
- [ ] Unit tests and integration tests
- [ ] E2E test (if user-critical)
- [ ] Logging/metrics without sensitive data (redaction allowlist updated if needed)
- [ ] Accessibility review (keyboard, labels, contrast, reduced motion, not colour-only)
- [ ] Documentation updated
- [ ] Error handling and recovery
- [ ] Security review proportional to risk (threat-model items touched: TM-__)
- [ ] Feature flag / rollback plan
- [ ] Product-owner acceptance

### Financial / onchain changes (tick N/A if none)

- [ ] N/A
- [ ] Decimal-safe (`@suiem/shared/money`, no floats)
- [ ] Idempotent writes
- [ ] Transaction simulation where available
- [ ] Clear explicit user confirmation
- [ ] Reconciliation
- [ ] Contract tests
- [ ] Deployment manifest
- [ ] Audit / security review
- [ ] Legal / provider / jurisdiction approval

### Product boundaries (ADR-0001), always required

- [ ] Introduces no forbidden trigger (browsing, detection, highlight, AI output, social action → order/transaction)
- [ ] No address used outside the registry / `VERIFIED_FACTS.md`
- [ ] Testnet (46630) only
