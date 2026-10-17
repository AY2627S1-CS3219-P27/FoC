import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const userService = process.env.USER_SERVICE_URL ?? "http://localhost:3000";
    const supplierService =
      process.env.SUPPLIER_SERVICE_URL ?? "http://localhost:3002";
    const creditService =
      process.env.CREDIT_SERVICE_URL ?? "http://localhost:3003";
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
    ];
  },
};

export default nextConfig;
