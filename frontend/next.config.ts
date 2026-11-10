import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Read at `next build`, so the production image bakes in these service URLs.
  async rewrites() {
    const userService = process.env.USER_SERVICE_URL ?? "http://localhost:3000";
    const supplierService =
      process.env.SUPPLIER_SERVICE_URL ?? "http://localhost:3002";
    const creditService =
      process.env.CREDIT_SERVICE_URL ?? "http://localhost:3003";
    const orderService =
      process.env.ORDER_SERVICE_URL ?? "http://localhost:3004";
    const commsService =
      process.env.COMMS_SERVICE_URL ?? "http://localhost:3006";
    const notificationService =
      process.env.NOTIFICATION_SERVICE_URL ?? "http://localhost:3007";
    const ragService = process.env.RAG_SERVICE_URL ?? "http://localhost:3008";
    const socketPath = process.env.SOCKET_PATH ?? "/socket.io";
    return [
      // Matches the refresh cookie's Path=/auth/refresh, so the browser sends it.
      { source: "/auth/refresh", destination: `${userService}/auth/refresh` },
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
        source: "/api/supplier-requests/:path*",
        destination: `${supplierService}/supplier-requests/:path*`,
      },
      {
        source: "/api/buildings/:path*",
        destination: `${supplierService}/buildings/:path*`,
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
      {
        source: "/api/chats/:path*",
        destination: `${commsService}/v1/chats/:path*`,
      },
      {
        source: "/api/notifications/:path*",
        destination: `${notificationService}/v1/:path*`,
      },
      {
        source: "/api/assistant/:path*",
        destination: `${ragService}/assistant/:path*`,
      },
      {
        source: `${socketPath}/:path*`,
        destination: `${commsService}${socketPath}/:path*`,
      },
    ];
  },
};

export default nextConfig;
