import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The courier tracking stream (GET /api/errands/:id/tracking, text/event-stream) goes through the
  // rewrites below. Next's default gzip can buffer event streams, and the docs offer no per-route
  // exemption, so compression is turned off app-wide (compress: false). Put compression in front
  // (e.g. a reverse proxy) if bandwidth matters. Rewrites are proxied by Next's internal proxy,
  // which has its own timeout; a long-lived stream may be cut. The client reconnects with backoff
  // and falls back to polling, so a cut degrades gracefully.
  compress: false,
  async rewrites() {
    const userService = process.env.USER_SERVICE_URL ?? "http://localhost:3000";
    const supplierService =
      process.env.SUPPLIER_SERVICE_URL ?? "http://localhost:3002";
    const creditService =
      process.env.CREDIT_SERVICE_URL ?? "http://localhost:3003";
    const orderService =
      process.env.ORDER_SERVICE_URL ?? "http://localhost:3004";
    return [
      { source: "/api/auth/:path*", destination: `${userService}/auth/:path*` },
      { source: "/api/otp/:path*", destination: `${userService}/otp/:path*` },
      {
        source: "/api/users/:path*",
        destination: `${userService}/users/:path*`,
      },
      {
        source: "/api/password-reset/:path*",
        destination: `${userService}/password-reset/:path*`,
      },
      {
        source: "/api/suppliers/:path*",
        destination: `${supplierService}/suppliers/:path*`,
      },
      {
        source: "/api/buildings",
        destination: `${supplierService}/buildings`,
      },
      {
        source: "/api/categories",
        destination: `${supplierService}/categories`,
      },
      {
        source: "/api/credits/:path*",
        destination: `${creditService}/v1/credits/:path*`,
      },
      {
        source: "/api/errands/:path*",
        destination: `${orderService}/v1/errands/:path*`,
      },
      {
        source: "/api/admin/:path*",
        destination: `${orderService}/v1/admin/:path*`,
      },
    ];
  },
};

export default nextConfig;
