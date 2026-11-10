/**
 * Secret access goes through this interface so a cloud secret manager can replace `.env`
 * without touching call sites (PO decision OQ-S-01). Secrets are never logged.
 */
export interface SecretProvider {
  /** Returns the secret or undefined. Never throws for a missing optional secret. */
  get(name: string): string | undefined;
  /** Returns the secret or throws a message that names the key but never shows a value. */
  require(name: string): string;
}

export class EnvSecretProvider implements SecretProvider {
  constructor(private readonly env: Record<string, string | undefined> = process.env) {}

  get(name: string): string | undefined {
    const value = this.env[name];
    return value === undefined || value === "" ? undefined : value;
  }

  require(name: string): string {
    const value = this.get(name);
    if (value === undefined) throw new Error(`Missing required secret: ${name}`);
    return value;
  }
}
