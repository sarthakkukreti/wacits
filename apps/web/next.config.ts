import type { NextConfig } from "next";

// PRD §3.2 — Next.js talks to the Bun/Hono API over HTTP and never embeds
// business logic, tenant scoping, or the webhook receiver (see §4.1).
//
// output: "standalone" is here specifically for the Hostinger shared-
// hosting deployment path (see RUNBOOK.md "Split hosting"): `next build`
// produces a self-contained server.js plus a trimmed node_modules in
// .next/standalone, so the app can be built once elsewhere and the output
// uploaded as a plain Node.js app — no Bun, no monorepo, no `npm install`
// required on Hostinger's end. `bun run package:hostinger` (see
// package.json) builds and packages it in one step.
//
// Because this app lives inside a Bun workspaces monorepo, Next.js
// correctly nests the standalone output under apps/web/server.js rather
// than putting it at the top of .next/standalone — that preserves the
// hoisted node_modules Node needs to resolve `next`/`react`/etc. via its
// normal upward directory walk. Do NOT try to flatten this with
// outputFileTracingRoot/turbopack.root — that fights Turbopack's own
// module resolution and breaks the build. scripts/package-standalone.sh
// handles the nested path; see it and RUNBOOK.md for the Hostinger startup
// file setting this implies (apps/web/server.js, not server.js).
const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "standalone",
  // This app never uses next/image. `images.unoptimized` documents that
  // intent, but it does NOT stop Next's file tracer from bundling `sharp`
  // into the standalone output anyway — it's traced in unconditionally as
  // an optional dependency of `next` itself, and `outputFileTracingExcludes`
  // globs did not exclude it either when tried against this Bun-workspace
  // node_modules layout (`.bun/<pkg>@<version>+<hash>/...`) — worth
  // re-checking against a future Next.js version, but not relied on today.
  // The actual fix lives in scripts/package-standalone.sh, which deletes
  // sharp/@img from the built output and VERIFIES they're gone before
  // zipping — that matters because sharp ships prebuilt native binaries
  // for whatever OS/arch it was installed on, and built on a developer's
  // Mac those binaries are darwin-arm64 and will not run on Hostinger's
  // Linux server.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
