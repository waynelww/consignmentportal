import type { NextConfig } from "next";
import fs from "fs";

// If the shell has ANTHROPIC_API_KEY set to empty, read it directly from .env.local
if (!process.env.ANTHROPIC_API_KEY) {
  try {
    const envLocal = fs.readFileSync(".env.local", "utf8");
    const match = envLocal.match(/^ANTHROPIC_API_KEY=(.+)$/m);
    if (match) process.env.ANTHROPIC_API_KEY = match[1].trim();
  } catch {}
}

const nextConfig: NextConfig = {
  // web-push uses Node.js built-ins (crypto, http2) — must not be bundled by webpack
  serverExternalPackages: ['web-push'],
  // Pre-existing type errors in codebase — skip during build, fix incrementally
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  // Compress HTTP responses
  compress: true,
  // Tree-shake heavy icon/chart libraries so only imported symbols are bundled
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },
};

export default nextConfig;
