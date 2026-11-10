# ADR-0010: Admin RBAC, dual control and single-maintainer mode

- Status: Accepted (PO decision OQ-P-06, 2026-11-10) · Covers: PRD §22, ARCHITECTURE TM-16

## Context

PRD §22 requires role-based access, MFA, reason codes, an immutable audit record, approval workflows for sensitive operations and separation of duties. Suiem currently has a single maintainer (OQ-P-06), so true separation of duties between people is impossible.

## Decision

1. **Roles** (`admin_roles`): `support`, `moderator`, `ops`, `security`, `superadmin`. Permissions are checked server-side per route. A role is never inferred from the client.
2. **MFA:** every admin route requires a session whose authentication methods include `passkey`, with passkey verification in the last 12 hours. An OTP-only session is rejected (HTTP 403 `MFA_REQUIRED`) and the attempt is written to `audit_logs`.
3. **Reason codes:** every admin request carries a `reasonCode` from a fixed enum (`SUPPORT_TICKET`, `INCIDENT`, `MODERATION`, `SECURITY_REVIEW`, `CONFIG_CHANGE`, `AUDIT`, `TEST_ENV`) and free-text `reasonNote`. A missing reason is rejected and audited.
4. **Dual control** (`dual_control_requests`): sensitive actions (granting or revoking admin roles, changing feature flags, changing jurisdiction policy) are *requested* by one admin and *executed* only when a **different** admin approves. The DB enforces `approved_by <> requested_by` with a CHECK, and the service enforces it too. Requests expire after 24 h. Every transition is recorded in the append-only `admin_actions`.
5. **Single-maintainer mode:** in local/dev the seed creates two admin identities (`admin1@suiem.local`, `admin2@suiem.local`). One person can operate both, which **defeats separation of duties**. That is acceptable only because Phase 2 is local-only with no real assets. The flag `ADMIN_SINGLE_MAINTAINER_MODE=true` is shown as a persistent banner in the admin UI.
6. **Before any shared or beta environment (Phase 8),** at least two distinct humans must hold admin roles, seeded dev admins must not exist, and the boot check refuses to start in `NODE_ENV=production` with `ADMIN_SINGLE_MAINTAINER_MODE=true`.

## Risks accepted

- R-ADM-1: one person can approve their own sensitive change through a second identity. Mitigations: local-only scope, the banner, the audit trail, and the production boot refusal.
- R-ADM-2: the audit log is append-only at the DB level, but a DB superuser can still alter it. Mitigation in Phase 8: ship audit events to external WORM storage.
