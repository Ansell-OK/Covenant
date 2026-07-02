import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile monorepo workspace packages (linked via npm workspaces)
  // Next.js will compile their TypeScript source directly.
  transpilePackages: [
    "@covenant/core",
    "@covenant/policy-compiler",
    "@covenant/flowvault-adapter",
  ],
};

export default nextConfig;
