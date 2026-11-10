/**
 * Smart-account abstraction (ADR-0002 §2, Option A). STUB in Phase 2: the AA spike
 * (VERIFIED_FACTS §4a) found EntryPoints and the P-256 precompile on 46630, but bundler and
 * paymaster availability is unverified, so Phase 2 ships external wallets via SIWE only
 * (PO decision OQ-PR-05). No session keys, no automation modules, ever (ADR-0001 §2).
 */
export interface SmartAccountProvider {
  readonly name: string;
  readonly available: boolean;
  /** Counterfactual address for a passkey owner, without deploying anything. */
  getAccountAddress(input: { passkeyPublicKey: Uint8Array }): Promise<`0x${string}`>;
}

export class SmartAccountUnavailableError extends Error {
  override readonly name = "SmartAccountUnavailableError";
  constructor() {
    super("Smart accounts are not available in Phase 2 (bundler/paymaster unverified on 46630).");
  }
}

export class UnavailableSmartAccountProvider implements SmartAccountProvider {
  readonly name = "unavailable";
  readonly available = false;
  async getAccountAddress(): Promise<`0x${string}`> {
    throw new SmartAccountUnavailableError();
  }
}
