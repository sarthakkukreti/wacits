import type { NextConfig } from "next";

// PRD §3.2 — Next.js runs as its own container, talking to the Bun/Hono
// API over HTTP. It never embeds business logic, tenant scoping, or the
// webhook receiver (see §4.1).
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
