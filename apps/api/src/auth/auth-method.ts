/**
 * AuthMethod extension point (PO decision OQ-P-05). Phase 2 implements `email_otp` and
 * `passkey`. OAuth providers can be added later by implementing this interface plus a migration
 * that extends `user_auth_methods.kind`. SIWE is deliberately NOT an AuthMethod: wallets are
 * linked to an existing account, never used to log in.
 */
export interface AuthMethod {
  readonly kind: "email_otp" | "passkey";
  /** Whether a successful ceremony counts as phishing-resistant MFA for admin access. */
  readonly phishingResistant: boolean;
}

export const AUTH_METHODS: Record<AuthMethod["kind"], AuthMethod> = {
  email_otp: { kind: "email_otp", phishingResistant: false },
  passkey: { kind: "passkey", phishingResistant: true },
};
