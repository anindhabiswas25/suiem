import "fastify";

export interface SessionInfo {
  sessionId: string;
  userId: string;
  amr: ("passkey" | "siwe")[];
  expiresAt: Date;
}

export interface DeviceInfo {
  installationId: string;
  userId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    suiem: {
      requestId: string;
      session?: SessionInfo;
      device?: DeviceInfo;
      startedAt: bigint;
    };
  }
}

export const SESSION_COOKIE = "suiem_sid";
export const CSRF_COOKIE = "suiem_csrf";
export const CSRF_HEADER = "x-csrf-token";
