import "fastify";

export interface SessionInfo {
  sessionId: string;
  userId: string;
  amr: ("email_otp" | "passkey")[];
  passkeyVerifiedAt: Date | null;
  expiresAt: Date;
}

export interface AdminInfo {
  roles: string[];
  reasonCode: string;
  reasonNote: string;
}

declare module "fastify" {
  interface FastifyRequest {
    suiem: {
      requestId: string;
      session?: SessionInfo;
      admin?: AdminInfo;
      startedAt: bigint;
    };
  }
}

export const SESSION_COOKIE = "suiem_sid";
export const CSRF_COOKIE = "suiem_csrf";
export const CSRF_HEADER = "x-csrf-token";
export const REASON_CODE_HEADER = "x-suiem-reason-code";
export const REASON_NOTE_HEADER = "x-suiem-reason-note";
export const IDEMPOTENCY_HEADER = "idempotency-key";
