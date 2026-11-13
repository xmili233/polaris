#!/bin/sh
# Link the bundled CLI without replacing an existing command.
set -eu
cd "$(dirname "$0")/.."
CLI="$PWD/build/Polaris.app/Contents/Resources/bin/polaris"
BIN_DIR="${POLARIS_BIN_DIR:-$HOME/.local/bin}"
LINK="$BIN_DIR/polaris"
[ -x "$CLI" ] || { echo 'Run macos/scripts/build-app.sh first.' >&2; exit 1; }
if [ -e "$LINK" ] || [ -L "$LINK" ]; then
    [ -L "$LINK" ] && [ "$(readlink "$LINK")" = "$CLI" ] || { echo "Refusing to replace $LINK" >&2; exit 1; }
else
    mkdir -p "$BIN_DIR"
    ln -s "$CLI" "$LINK"
fi
printf 'CLI: %s\n' "$LINK"
