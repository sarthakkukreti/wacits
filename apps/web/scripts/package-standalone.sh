#!/usr/bin/env bash
# Packages the Next.js standalone build for upload to Hostinger's Node.js
# App wizard (see RUNBOOK.md "Split hosting"). Run via `bun run
# package:hostinger` — do not run this directly unless `next build` has
# already produced .next/standalone.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d ".next/standalone" ]; then
  echo "error: .next/standalone not found — run 'next build' first (output: \"standalone\" must be set in next.config.ts)." >&2
  exit 1
fi

# This app lives inside a Bun workspaces monorepo, so Next.js nests the
# standalone output under apps/web/server.js rather than putting it at the
# top of .next/standalone (that nesting is correct — see next.config.ts).
# Find it rather than hardcode the path, so this script keeps working if
# the app is ever moved.
APP_DIR="$(dirname "$(find .next/standalone -name server.js -not -path '*/node_modules/*' | head -1)")"
if [ -z "$APP_DIR" ] || [ ! -f "$APP_DIR/server.js" ]; then
  echo "error: could not find server.js under .next/standalone" >&2
  exit 1
fi
echo "App directory inside the standalone output: $APP_DIR"

mkdir -p "$APP_DIR/.next"
cp -r .next/static "$APP_DIR/.next/static"

# public/ is optional in Next.js — only copy it if this app actually has one.
if [ -d "public" ]; then
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

# Hostinger's Node.js wizard (Passenger) inspects the application ROOT for a
# package.json and, if it finds a `build` script, runs `npm install && npm run
# build` on deploy. That is exactly wrong here: this output is ALREADY built,
# its node_modules is a pruned production tree with no devDependencies, and
# `next build` needs typescript/@types — so the hosted build fails ("Last build
# failed!") and nothing ever starts. Observed live on Hostinger.
#
# Next's own standalone output leaves the root bare (only apps/ and
# node_modules/ — the nested apps/web/package.json it copies still carries the
# source `build` script). So write a root package.json that declares ONLY a
# start script and no dependencies: nothing for the host to install, nothing
# for it to build.
REL_APP_DIR="${APP_DIR#.next/standalone/}"
cat > ".next/standalone/package.json" <<EOF
{
  "name": "wacits-web",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "start": "node $REL_APP_DIR/server.js"
  }
}
EOF

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

rm -f wacits-web.zip
(cd .next/standalone && zip -r -q ../../wacits-web.zip . -x '*.map')

SIZE="$(du -h wacits-web.zip | cut -f1)"
echo
echo "Wrote apps/web/wacits-web.zip ($SIZE)."
echo "In the Hostinger Node.js App wizard:"
echo "  - Framework: 'Other'"
echo "  - Startup / entry file: server.js   (root shim; $REL_APP_DIR/server.js also works)"
echo "  - Build command: leave EMPTY — this package is already built."
echo "  - Set API_BASE_URL, API_SHARED_SECRET and WORKSPACE_SLUG in the app's environment-variable settings."
