import "fastify";

export interface SessionInfo {
  sessionId: string;
  userId: string;
  amr: ("passkey" | "siwe")[];
  expiresAt: Date;
}

declare module "fastify" {
  interface FastifyRequest {
    suiem: {
      requestId: string;
      session?: SessionInfo;
      startedAt: bigint;
    };
  }
}

export const SESSION_COOKIE = "suiem_sid";
export const CSRF_COOKIE = "suiem_csrf";
export const CSRF_HEADER = "x-csrf-token";
