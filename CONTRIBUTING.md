# Contributing

Use [Issues](https://github.com/xmili233/polaris/issues) for reproducible bugs and focused proposals. Include the macOS version, Polaris commit or version, native Agent client and version, reproduction steps, and expected and observed behavior. Discuss substantial behavior changes before implementing them. Report security issues through [SECURITY.md](SECURITY.md).

## Local development

Use macOS 15+, Node.js 24+ and the pnpm version pinned in `package.json`.

```sh
pnpm install --frozen-lockfile
pnpm --filter polaris-desktop dev -- --database /tmp/polaris-dev/polaris.sqlite
```

Use an isolated database rather than your everyday workspace. Native clients are needed for interactive Agent use. Ordinary automated tests use protocol fixtures and require no provider account or API key.

Read [architecture.md](architecture.md) for ownership and data contracts. Before UI changes, read [design.decisions.md](design.decisions.md), then the relevant [visual](design.md) and [interaction](interaction.md) rules. Keep desktop visual values in `desktop/src/theme.css`.

## Verification

Run the same checks as CI from the repository root:

```sh
pnpm verify
```

This checks translations, runs service tests, builds the desktop and website, and runs the selected desktop and website integration tests. Desktop tests use temporary databases and hidden, non-focusable windows with `POLARIS_TEST=1`. They must not focus the app or send input to the user's foreground application. Test screenshots stay in the ignored `desktop/test-results/` directory. CI sets `POLARIS_TEST_REDUCED_MOTION=0` so the runner's Reduce Motion setting does not decide whether animated UI renders; it has no effect outside tests.

Use the focused commands in [desktop/README.md](desktop/README.md) while working. Real-model evaluations are separate, may consume account quota and require explicit authorization. Fixture results do not establish real-model behavior.

## Releasing

Releases are published by [.github/workflows/release.yml](.github/workflows/release.yml). Update `version` in `desktop/package.json`, commit, then push a matching tag:

```sh
git tag v0.1.0
git push origin v0.1.0
```

The workflow checks that the tag matches the version and that the Verify workflow passed for the same commit, runs the unit tests, builds Apple silicon and Intel apps, signs them with the Developer ID certificate and the hardened runtime, notarizes and staples the apps and their disk images, and publishes `Polaris-macOS-arm64.dmg`, `Polaris-macOS-x64.dmg` and `SHA256SUMS` as a GitHub Release. Asset names carry no version, so `releases/latest/download/…` links on the website and in the README always reach the newest release. Do not mark a release as a pre-release; GitHub's latest link skips those. Run the workflow manually to check signing and notarization without publishing.

It needs these repository secrets:

| Secret | Value |
| --- | --- |
| `MACOS_CERTIFICATE_P12` | The Developer ID Application certificate and private key, exported as `.p12` and base64-encoded |
| `MACOS_CERTIFICATE_PASSWORD` | The `.p12` export password |
| `MACOS_SIGN_IDENTITY` | The certificate name, such as `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD` | The Apple ID, the Developer team ID and an [app-specific password](https://support.apple.com/102654) used only for notarization |

Notarization can use an App Store Connect API key instead: set `APPLE_API_KEY_P8` (the `AuthKey_….p8` contents, Developer role), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER_ID`; the key wins when both are present.

To build the same release locally, set `POLARIS_SIGN_IDENTITY` and one of `POLARIS_NOTARY_PROFILE` (a profile saved with `xcrun notarytool store-credentials`), the API key variables `POLARIS_NOTARY_KEY`, `POLARIS_NOTARY_KEY_ID` and `POLARIS_NOTARY_ISSUER`, or `POLARIS_NOTARY_APPLE_ID`, `POLARIS_NOTARY_TEAM_ID` and `POLARIS_NOTARY_PASSWORD`, then run `node desktop/scripts/release.mjs`. The disk images and checksums appear in the ignored `macos/release/` directory. `--no-notarize` signs without notarizing, for checking the build only; never publish its output. Credentials stay in the keychain, environment or ignored files and never enter the repository or build output.

## Language and data

- Maintain English source documentation, prompts, tool instructions and raw service diagnostics.
- Add user-facing UI text to all nine files in `packages/i18n/locales/`, using stable semantic keys, named variables and the applicable plural forms. English is the authoring baseline. Run `pnpm i18n:check`; `pnpm i18n:extract` assists extraction but does not replace translation review.
- Keep user-authored content in its original language. Chinese and other Unicode fixtures are intentional regression coverage.
- Localize service errors through their message keys and parameters. Preserve raw diagnostics and response IDs. Tool activity stays English.
- Never commit workspace databases, credentials, personal transcripts or unreviewed screenshots. Use fictional data for examples and tests.

## Pull requests

Keep changes focused. Describe the problem, resulting behavior and checks run. Preserve validation, record-version checks, idempotency and data migrations. Use existing components and dependencies where possible. Include applicable notices when bringing in third-party code or assets. Current documents describe the supported behavior; earlier prototypes and design alternatives are not kept.

Contributions to Polaris are provided under [AGPL-3.0-only](LICENSE), unless explicitly identified as third-party material under its own compatible license. Submit only work you have the right to contribute, and preserve third-party notices.
