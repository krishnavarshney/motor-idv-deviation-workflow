import type {NextConfig} from "next";
const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["playwright"],
};
export default nextConfig;