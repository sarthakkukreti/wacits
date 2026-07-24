// Builds the dashboard as part of `npm install`.
//
// Hostinger deploys this repo from git and runs a FIXED command sequence that
// its panel does not expose for editing:
//
//   Install command:  npm install
//   Build command:    (empty)
//   Output directory: (empty)
//
// With no build command there is no other hook: `npm install` succeeds, the
// server then starts `apps/web/.next/standalone/server.js`, that path does not
// exist because nothing ever built it, and Apache falls through to the empty
// document root and answers 403. npm runs `postinstall` after a successful
// install, so that is where the build has to go.
//
// It must NOT run under Bun. Everything else in this repo uses `bun install`,
// and doing a full Next.js production build on every dependency change locally
// would be both slow and surprising. npm and Bun both set npm_config_user_agent
// and prefix it with their own name, so that distinguishes them reliably;
// anything that is not npm skips out.

import { execSync } from "node:child_process";

const userAgent = process.env.npm_config_user_agent ?? "";
const isNpm = userAgent.startsWith("npm/");

if (!isNpm) {
  console.log(
    `[postinstall] Skipping dashboard build — not running under npm (user agent: ${userAgent || "unset"}).`,
  );
  process.exit(0);
}

console.log("[postinstall] npm detected — building the dashboard for deployment.");

try {
  execSync("npm run build", { stdio: "inherit" });
} catch (error) {
  console.error("[postinstall] Dashboard build failed.");
  process.exit(1);
}
