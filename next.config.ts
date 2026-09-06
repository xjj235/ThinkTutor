import type { NextConfig } from "next";

export default function nextConfig(phase: string): NextConfig {
  const distDir = process.env.THINKTUTOR_DIST_DIR ?? ".next";
  if (!/^\.next(?:\/[a-zA-Z0-9_-]+)?$/u.test(distDir)) throw new Error("THINKTUTOR_DIST_DIR must stay under .next");
  const developmentServer = phase === "phase-development-server";
  const scriptSources = developmentServer
    ? "'self' 'unsafe-inline' 'unsafe-eval'"
    : "'self' 'unsafe-inline'";
  const contentSecurityPolicy = [
    "default-src 'self'",
    `script-src ${scriptSources}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.aliyuncs.com",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ");

  return {
    distDir,
    output: "standalone",
    async headers() {
      return [
        {
          source: "/(.*)",
          headers: [
            { key: "Content-Security-Policy", value: contentSecurityPolicy },
            { key: "Referrer-Policy", value: "no-referrer" },
            { key: "X-Content-Type-Options", value: "nosniff" },
            { key: "X-Frame-Options", value: "DENY" },
            { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
            { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          ],
        },
      ];
    },
  };
}
