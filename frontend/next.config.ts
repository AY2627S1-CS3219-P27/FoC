import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Same-origin proxy to user-service: no CORS, and its httpOnly cookie is set for our origin.
  async rewrites() {
    const target = process.env.USER_SERVICE_URL ?? "http://localhost:3000";
    return [
      {
        source: "/api/auth/:path*",
        destination: `${target}/auth/:path*`,
      },
      { source: "/api/otp/:path*", destination: `${target}/otp/:path*` },
    ];
  },
};

export default nextConfig;
