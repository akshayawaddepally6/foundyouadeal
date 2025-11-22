import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Empty turbopack config to silence Next.js 16 warning
  // The fine-tuning folder is automatically excluded as it's outside src/ and not imported
  turbopack: {},

  webpack: (config, { isServer }) => {
    // Exclude fine-tuning folder from webpack file watching (fallback for --webpack mode)
    config.watchOptions = {
      ...config.watchOptions,
      ignored: ['**/fine-tuning/**', '**/node_modules/**'],
    };
    return config;
  },
};

export default nextConfig;
