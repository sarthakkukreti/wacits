#!/usr/bin/env bash
# Turns Next's raw `.next/standalone` output into a tree that a plain Node.js
# host (Hostinger/Passenger) can run directly, with nothing to install and
# nothing to build.
#
# Shared by both deployment paths — scripts/package-standalone.sh (zip upload)
# and scripts/deploy-hostinger.sh (git branch). Do not run directly unless
# `next build` has already produced .next/standalone.
#
# Exports REL_APP_DIR (e.g. "apps/web") for callers that need it.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d ".next/standalone" ]; then
  echo "error: .next/standalone not found — run 'next build' first (output: \"standalone\" must be set in next.config.ts)." >&2
  exit 1
fi

# This app lives inside a Bun workspaces monorepo, so Next.js nests the
# standalone output under apps/web/server.js rather than putting it at the
# top of .next/standalone (that nesting is correct — see next.config.ts).
# Find it rather than hardcode the path, so this keeps working if the app is
# ever moved.
APP_DIR="$(dirname "$(find .next/standalone -name server.js -not -path '*/node_modules/*' | head -1)")"
if [ -z "$APP_DIR" ] || [ ! -f "$APP_DIR/server.js" ]; then
  echo "error: could not find server.js under .next/standalone" >&2
  exit 1
fi
REL_APP_DIR="${APP_DIR#.next/standalone/}"
echo "App directory inside the standalone output: $APP_DIR"

mkdir -p "$APP_DIR/.next"
rm -rf "$APP_DIR/.next/static"
cp -r .next/static "$APP_DIR/.next/static"

# public/ is optional in Next.js — only copy it if this app actually has one.
if [ -d "public" ]; then
  rm -rf "$APP_DIR/public"
  cp -r public "$APP_DIR/public"
fi

# Next's file tracer preserves Bun's INTERNAL compatibility layer
# (node_modules/.bun/node_modules/<pkg>) but not the top-level
# node_modules/<pkg> entries plain Node.js actually walks up to find. In
# place, this "worked" only because Node's upward search escaped the
# incomplete standalone folder and stumbled onto the real monorepo's root
# node_modules sitting right above it on disk — which obviously isn't there
# once this is deployed anywhere else (confirmed: server.js throws
# MODULE_NOT_FOUND for @swc/helpers subpaths the moment this folder is
# moved). Promoting Bun's hoisted layer to the real top level recreates the
# structure plain Node.js expects, independent of where this ends up.
if [ -d ".next/standalone/node_modules/.bun/node_modules" ]; then
  cp -RL .next/standalone/node_modules/.bun/node_modules/. .next/standalone/node_modules/
fi

# sharp ships prebuilt native binaries for whatever OS/arch it was built
# on. This app never uses next/image, but Next's tracer bundles sharp into
# the standalone output regardless (outputFileTracingExcludes did not
# suppress it — see next.config.ts). Strip it and VERIFY it's gone, rather
# than trust config that's already been observed not to work: built on a
# developer's Mac, these binaries are darwin-arm64 and will silently fail
# on Hostinger's Linux server if left in.
# Bun's node_modules layout uses symlinks (e.g. node_modules/.bun/node_modules/sharp
# -> ../sharp@x.y.z/node_modules/sharp) alongside the real package
# directories — match both types, or the symlinks survive `find -type d`
# and still point at the excluded binary.
find .next/standalone \( -type d -o -type l \) \( -iname "sharp*" -o -iname "*sharp-*" -o -iname "@img*" \) -prune -exec rm -rf {} +

remaining="$(find .next/standalone -iname "*sharp*" -o -iname "*@img*" 2>/dev/null || true)"
if [ -n "$remaining" ]; then
  echo "error: sharp/@img still present after stripping — refusing to package a build with the wrong-architecture native binary:" >&2
  echo "$remaining" >&2
  exit 1
fi

# --- Root package.json -------------------------------------------------
#
# Hostinger runs `npm install` (and often `npm run build`) in the application
# root on every deploy. Two separate failures came out of that:
#
#  1. Next's standalone output leaves the root bare, so the wizard fell through
#     to the nested apps/web/package.json — which still carries the source
#     `build` script — and ran `next build` against an already-built tree whose
#     pruned production node_modules has no typescript/@types. Build failed.
#
#  2. Deploying from git instead, npm read the MONOREPO root package.json,
#     followed "workspaces": ["apps/*", "packages/*"] into apps/api and
#     packages/db, and hit `"@wacits/db": "workspace:*"` — Bun's workspace
#     protocol, which npm does not implement:
#       npm error code EUNSUPPORTEDPROTOCOL
#       npm error Unsupported URL Type "workspace:": workspace:*
#
# A self-contained root package.json fixes both: npm resolves only these
# plain-registry packages and never reaches a workspace: reference, and the
# no-op build script means an unconditional `npm run build` succeeds instead
# of dying on "missing script: build".
#
# The dependencies below are NOT optional, and must not be emptied out. A
# dependency-free package.json was tried first and is actively destructive:
# npm treats every vendored package as extraneous and prunes it —
#   $ npm install
#   removed 9 packages
# leaving node_modules with only @next/ and @swc/, i.e. no next, react or
# react-dom, and an app that cannot boot. Declaring them keeps the tree intact;
# npm reinstalls anything the tracer left incomplete rather than deleting it.
#
# Versions are pinned exactly to what this build actually resolved, read back
# out of the built tree rather than copied from apps/web/package.json — those
# are ranges ("^16.2.0"), and a range would let the host install a different
# Next.js than the one that produced .next/, which is precisely the kind of
# skew that turns into an unreproducible runtime error on someone else's
# server.
#
# Letting npm install run also fixes sharp properly. It is stripped above
# because a macOS build bundles darwin-arm64 binaries that cannot run on
# Hostinger's Linux; with next declared as a real dependency, npm reinstalls
# sharp for whatever platform the host actually is.
node - "$REL_APP_DIR" > ".next/standalone/package.json" <<'NODE'
const { readFileSync, existsSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
// Reading the script from stdin puts "-" in argv[1], so the first real
// argument lands at argv[2].
const relAppDir = process.argv[2];
if (!relAppDir || relAppDir === "-") {
  console.error("error: app directory argument missing");
  process.exit(1);
}

// Locate the traced node_modules rather than assuming it sits directly under
// .next/standalone. Next mirrors the workspace root's path *from the
// filesystem root* inside the standalone output, so its depth depends entirely
// on where the checkout happens to live. Locally that yields
// .next/standalone/node_modules; on Hostinger, which builds in
// /builds/source/repository, it yields
// .next/standalone/builds/source/repository/node_modules — and hardcoding the
// former made this step fail there with "could not resolve the built Next.js
// version". Walk down and find it instead.
function findNodeModules(dir, depth = 0) {
  if (depth > 8) return null;
  const candidate = join(dir, "node_modules", "next", "package.json");
  if (existsSync(candidate)) return join(dir, "node_modules");
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules") continue;
    const found = findNodeModules(join(dir, entry.name), depth + 1);
    if (found) return found;
  }
  return null;
}

const nodeModules = findNodeModules(".next/standalone");
if (!nodeModules) {
  console.error("error: could not find the traced node_modules containing next/ under .next/standalone.");
  process.exit(1);
}

// Direct dependencies come from the app's own manifest; their exact resolved
// versions come from the build output. Transitive deps are left for npm.
const appManifest = JSON.parse(readFileSync("package.json", "utf8"));
const dependencies = {};
for (const name of Object.keys(appManifest.dependencies ?? {})) {
  const manifestPath = join(nodeModules, name, "package.json");
  if (!existsSync(manifestPath)) continue; // build-time-only shim, e.g. server-only
  dependencies[name] = JSON.parse(readFileSync(manifestPath, "utf8")).version;
}

if (!dependencies.next) {
  console.error("error: could not resolve the built Next.js version — refusing to emit a package.json that would let the host install a different one.");
  process.exit(1);
}

console.log(JSON.stringify({
  name: "wacits-web",
  version: "0.1.0",
  private: true,
  description: "Pre-built Next.js standalone output — already built, versions pinned to the build.",
  scripts: {
    build: "echo 'Already built at package time — nothing to do.'",
    start: `node ${relAppDir}/server.js`,
  },
  dependencies,
}, null, 2));
NODE

# Next nests the real server under apps/web/server.js in a workspaces monorepo,
# but Hostinger's wizard defaults its startup field to a root-level file and
# typing the nested path by hand is the single most common way to misconfigure
# this. A one-line root shim makes plain `server.js` correct too — safe because
# the nested server.js does its own process.chdir(__dirname), so it does not
# care where it is required from.
cat > ".next/standalone/server.js" <<EOF
// Entry point for hosts that expect a root-level startup file (Hostinger /
// Passenger). The real server lives in the nested standalone output; it
// chdir()s to its own directory on startup, so requiring it from here is safe.
require("./$REL_APP_DIR/server.js");
EOF

export REL_APP_DIR
