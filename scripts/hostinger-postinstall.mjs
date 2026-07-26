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

// Matches PassengerRestartDir in apps/web/scripts/hostinger.htaccess.
const PASSENGER_RESTART_DIR = "tmp";

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

// Install the Passenger/LiteSpeed wiring. Hostinger creates the Node app but
// never writes these directives, so without them Apache serves the git
// checkout and returns 403. The document root IS this checkout (npm install
// runs here), so copy the tracked template to ./.htaccess. Doing it from
// postinstall makes it durable — a hand edit on the server survived earlier
// redeploys, but relying on that is fragile; this guarantees it. Only write
// when the marker is present so this is a no-op anywhere that is not this
// checkout's own document root.
try {
  const { copyFileSync, existsSync } = await import("node:fs");
  const src = "apps/web/scripts/hostinger.htaccess";
  if (existsSync(src) && existsSync(".builds")) {
    copyFileSync(src, ".htaccess");
    console.log("[postinstall] Installed Passenger .htaccess into the document root.");
  } else {
    console.log("[postinstall] Skipping .htaccess install — not the Hostinger document root.");
  }
} catch (error) {
  console.error("[postinstall] Could not install .htaccess:", error.message);
  // Non-fatal: the build already succeeded, and the .htaccess may have been
  // placed by hand. Do not fail the deploy over this.
}

// Force Passenger to restart. It does not notice a new deploy on its own —
// touching a file under PassengerRestartDir is the documented signal, and
// skipping this step is exactly how a stale worker process from the PREVIOUS
// build keeps serving requests: it already has the old build's static/chunk
// filenames resolved, so hashed chunk names that changed in the new build
// 404, which surfaces to users as "This page couldn't load". A file move to
// the same directory the previous deploy left tmp/ in doesn't survive
// between deploys either, so recreate it every time rather than assume it.
try {
  const { mkdirSync, writeFileSync, existsSync } = await import("node:fs");
  if (existsSync(".builds")) {
    mkdirSync(PASSENGER_RESTART_DIR, { recursive: true });
    writeFileSync(`${PASSENGER_RESTART_DIR}/restart.txt`, "");
    console.log("[postinstall] Touched restart.txt to force Passenger to reload the app.");
  }
} catch (error) {
  console.error("[postinstall] Could not touch restart.txt:", error.message);
}
