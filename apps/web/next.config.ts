import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ["@suiem/ui", "@suiem/shared", "@suiem/config"],
  async rewrites() {
    return {
      // The marketing landing page is a static port of the licensed Catalis template
      // (public/landing); it runs Webflow's own interaction scripts, so it is served as-is.
      beforeFiles: [{ source: "/", destination: "/landing/index.html" }],
      // /api/* is proxied by app/api/[...path]/route.ts (server-side, first-party cookies).
      afterFiles: [],
      fallback: [],
    };
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
