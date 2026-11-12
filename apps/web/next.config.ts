import type { NextConfig } from "next";

const apiUrl = process.env.API_URL ?? "http://localhost:4000";

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
  // Same-origin API: the browser only talks to the web origin, so session cookies stay first-party.
  async rewrites() {
    return {
      // The marketing landing page is a static port of the licensed Catalis template
      // (public/landing); it runs Webflow's own interaction scripts, so it is served as-is.
      beforeFiles: [{ source: "/", destination: "/landing/index.html" }],
      afterFiles: [{ source: "/api/:path*", destination: `${apiUrl}/api/:path*` }],
      fallback: [],
    };
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
