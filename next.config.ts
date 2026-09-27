import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["playwright"],
  async redirects() {
    return [
      { source: "/settings", destination: "/admin/rules", permanent: true },
      { source: "/health", destination: "/automation", permanent: false },
      { source: "/vehicles", destination: "/referrals", permanent: false },
    ];
  },
};

export default nextConfig;
