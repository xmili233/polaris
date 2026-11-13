#!/bin/sh
# Build the Electron desktop app, TypeScript service and CLI.
set -eu
cd "$(dirname "$0")/../../desktop"
pnpm install --frozen-lockfile
pnpm run build
pnpm run package
