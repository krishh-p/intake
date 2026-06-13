import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  logging: {
    incomingRequests: false,
    browserToTerminal: false,
  },
};

export default nextConfig;
