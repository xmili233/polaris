# Polaris desktop

Electron owns the window and operating-system integration. React uses an isolated preload; a utility process owns SQLite, native Agent sessions and task execution. Read the root [architecture](../architecture.md), [design decisions](../design.decisions.md) and [interaction rules](../interaction.md) before changing those contracts.

## Development

Use Node.js 24+ and the pnpm version pinned in the root package. Run against an isolated database:

```sh
pnpm install --frozen-lockfile
pnpm --filter polaris-desktop dev -- --database /tmp/polaris-dev/polaris.sqlite
```

The desktop starts from a local workspace. Native Agent authentication belongs to Codex, Claude Code or Gemini CLI; there is no Polaris account. See the [client compatibility table](../README.md#agent-clients) and [execution boundaries](../SECURITY.md#execution-and-data-boundaries).

`service/desktop-contract.ts` defines private IPC method inputs and replies. The main process validates the sender frame and allowed methods. Business tools validate scope, versions and request identities. Do not replace runtime validation with TypeScript casts.

## Build and verify

From the repository root:

```sh
pnpm verify
```

This runs the translation checks and unit tests, builds both apps, runs the desktop integration suite and checks the production website's nine locales. The GitHub workflow uses the same command on macOS with no native provider account or signing secrets.

Focused commands are available while developing:

```sh
pnpm test
pnpm --filter polaris-desktop build
pnpm --filter polaris-desktop test:ci
pnpm --filter polaris-desktop test:execution
pnpm --filter polaris-desktop test:i18n
pnpm --filter polaris-desktop test:agent
pnpm --filter polaris-desktop test:models
```

Build the desktop before UI tests. The service builds before unit tests. Fixture data lives in `tests/fixtures/`. UI tests use temporary databases, `POLARIS_TEST=1`, and hidden non-focusable Electron windows. They must not send input to the user's foreground application. Screenshots in `test-results/` verify layout; hidden-window timing is not foreground frame-rate evidence.

`./macos/scripts/build-app.sh` creates a local app bundle with the runtime and CLI for this Mac's architecture; `node scripts/package.mjs --arch x64 --out DIR` packages for the other one. Without `POLARIS_SIGN_IDENTITY` the bundle is ad-hoc signed; with a Developer ID it uses the hardened runtime and `macos/Resources/Polaris.entitlements`. `scripts/release.mjs` adds notarization and disk images; see [CONTRIBUTING.md](../CONTRIBUTING.md#releasing). A packaged app can run the UI tests with `POLARIS_APP=…/Polaris.app/Contents/MacOS/Polaris`. User databases, credentials and development environment files must never enter the bundle. The renderer cannot directly access Node.js, SQLite or credentials.

## Real-model checks

Ordinary tests use native protocol fixtures. Real-model behavior requires separate authorization and is not proven by fixture success:

```sh
POLARIS_EVAL_NATIVE=1 node desktop/tests/prompt-behavior.eval.mjs
```

Run from the repository root after building. The evaluator uses the existing native subscription and isolated workspaces to check conversational analysis, candidate plans, accepted planning changes, explicit stops, knowledge maintenance and background cards. `POLARIS_EVAL_CASES` selects cases; `POLARIS_EVAL_PROVIDER` and `POLARIS_EVAL_MODEL` select the native model. Keep failures visible and do not substitute text matching for actual behavioral verification.
