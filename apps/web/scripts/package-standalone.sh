#!/usr/bin/env bash
# Packages the Next.js standalone build as a zip for manual upload to
# Hostinger's Node.js App wizard (see RUNBOOK.md "Split hosting").
#
# Prefer `bun run deploy:hostinger` (scripts/deploy-hostinger.sh), which
# publishes the same output to the `hostinger-deploy` branch and lets
# Hostinger pull it directly — no manual upload step. This zip path remains
# for hosts without a git integration.
#
# Run via `bun run package:hostinger` — do not run this directly unless
# `next build` has already produced .next/standalone.
set -euo pipefail
cd "$(dirname "$0")/.."

# All the real work — locating the nested app dir, restoring static assets,
# flattening Bun's hoisted node_modules for plain Node, stripping sharp's
# wrong-architecture binaries, and writing the dependency-free root
# package.json + server.js shim — is shared with the git deploy path.
bash scripts/prepare-standalone.sh

APP_DIR="$(dirname "$(find .next/standalone -name server.js -not -path '*/node_modules/*' -not -path '.next/standalone/server.js' | head -1)")"
REL_APP_DIR="${APP_DIR#.next/standalone/}"

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
