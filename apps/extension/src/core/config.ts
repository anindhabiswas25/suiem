/** Build-time constants (injected by wxt.config.ts). No secrets live in the bundle. */
declare const __SUIEM_WEB_ORIGIN__: string;
declare const __SUIEM_API_BASE__: string;
declare const __SUIEM_E2E__: boolean;

export const WEB_ORIGIN = __SUIEM_WEB_ORIGIN__;
export const API_BASE = __SUIEM_API_BASE__;
/** Test builds only: open shadow roots so Playwright can click toast buttons. */
export const E2E = __SUIEM_E2E__;
export const CONTENT_SCRIPT_ID = "suiem-detector";
export const DIGEST_ALARM = "suiem.digest";
