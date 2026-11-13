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

Releases are built, signed, notarized and published by [.github/workflows/release.yml](.github/workflows/release.yml) when a version tag is pushed. Nothing is uploaded by hand.

### Publish a version

1. Set `version` in `desktop/package.json` (for example `0.1.1`). The website FAQ and the app read this value.
2. Commit to `main`, push, and wait for the **Verify** workflow to pass on that commit. The release refuses commits that have not passed Verify.
3. Tag that commit with the matching version and push the tag. Use the GitHub noreply address so an annotated tag does not record a personal email:

   ```sh
   GIT_COMMITTER_EMAIL="118744514+xmili233@users.noreply.github.com" git tag -a v0.1.1 -m "Polaris 0.1.1"
   git push origin v0.1.1
   ```

4. Follow the **Release** run (`gh run watch`). It takes about ten minutes.
5. Check the published release: download the assets, compare them with `SHA256SUMS`, and confirm Gatekeeper accepts them as described in [SECURITY.md](SECURITY.md#verifying-a-download).

The workflow checks that the tag equals `v` plus the version and that Verify passed for the commit, runs the unit tests, builds Apple silicon and Intel apps, signs them with the Developer ID certificate and the hardened runtime, notarizes and staples the apps and their disk images, and publishes `Polaris-macOS-arm64.dmg`, `Polaris-macOS-x64.dmg` and `SHA256SUMS` with generated notes. Asset names carry no version, so `releases/latest/download/…` links on the website and in the README always reach the newest release. Do not mark a release as a pre-release or draft; GitHub's latest link skips those. To replace a mistaken tag before its run finishes, cancel the run, delete the tag locally and on GitHub, and tag again.

Run the workflow manually (**Actions → Release → Run workflow**, or `gh workflow run release.yml --ref main`) to check signing and notarization without publishing. While the repository is private, release downloads work only for collaborators; the public links start working once it is public.

### Credentials

The workflow reads these repository secrets:

| Secret | Value |
| --- | --- |
| `MACOS_CERTIFICATE_P12` | The Developer ID Application certificate and its private key only, exported as `.p12` and base64-encoded |
| `MACOS_CERTIFICATE_PASSWORD` | The `.p12` export password |
| `MACOS_SIGN_IDENTITY` | The certificate name, such as `Developer ID Application: Name (TEAMID)` |
| `APPLE_ID`, `APPLE_TEAM_ID`, `APPLE_APP_PASSWORD` | The Apple ID, the Developer team ID and an [app-specific password](https://support.apple.com/102654) used only for notarization |

Notarization can use an App Store Connect API key instead: set `APPLE_API_KEY_P8` (the `AuthKey_….p8` contents, Developer role), `APPLE_API_KEY_ID` and `APPLE_API_ISSUER_ID`; the key wins when both are present.

Set or rotate a secret from your own terminal so its value never appears in logs or chats, for example `gh secret set APPLE_APP_PASSWORD -R xmili233/polaris` and paste the value at the prompt. To rotate the app-specific password, revoke it at account.apple.com, create a new one and update the secret. When the certificate is renewed, export only the new Developer ID identity and update the three `MACOS_*` secrets. The workflow imports the certificate into a temporary keychain and deletes it and the key file when it ends.

### Local releases

Save notarization credentials once in your login keychain from your own terminal:

```sh
xcrun notarytool store-credentials polaris --apple-id <Apple ID> --team-id <TEAMID>
```

Then run `POLARIS_SIGN_IDENTITY="Developer ID Application: Name (TEAMID)" POLARIS_NOTARY_PROFILE=polaris node desktop/scripts/release.mjs`. The API key variables `POLARIS_NOTARY_KEY`, `POLARIS_NOTARY_KEY_ID` and `POLARIS_NOTARY_ISSUER`, or `POLARIS_NOTARY_APPLE_ID`, `POLARIS_NOTARY_TEAM_ID` and `POLARIS_NOTARY_PASSWORD`, can replace the profile. `--arch arm64` builds one architecture; `--no-notarize` signs without notarizing, for checking the build only, and its output must never be published. The disk images and checksums appear in the ignored `macos/release/` directory. Credentials stay in the keychain or environment and never enter the repository or build output.

### When a release fails

| Symptom | Fix |
| --- | --- |
| `Tag … does not match desktop/package.json version` | Tag the commit whose `desktop/package.json` carries that version. |
| `Verify has not passed for …` | Wait for Verify on that commit, or fix it and tag the new commit. |
| Notarization returns HTTP 403, "A required agreement is missing or has expired" | The account holder accepts the updated Apple Developer Program License Agreement at developer.apple.com/account; it can take a few minutes to apply. |
| Notarization status is `Invalid` | The script prints Apple's notarization log; fix the reported binary or entitlement and release again. |
| Signing cannot find the identity | Check that `MACOS_SIGN_IDENTITY` matches the certificate name and that `MACOS_CERTIFICATE_P12` holds that identity with its private key. |

## Language and data

- Maintain English source documentation, prompts, tool instructions and raw service diagnostics.
- Add user-facing UI text to all nine files in `packages/i18n/locales/`, using stable semantic keys, named variables and the applicable plural forms. English is the authoring baseline. Run `pnpm i18n:check`; `pnpm i18n:extract` assists extraction but does not replace translation review.
- Keep user-authored content in its original language. Chinese and other Unicode fixtures are intentional regression coverage.
- Localize service errors through their message keys and parameters. Preserve raw diagnostics and response IDs. Tool activity stays English.
- Never commit workspace databases, credentials, personal transcripts or unreviewed screenshots. Use fictional data for examples and tests.

## Pull requests

Keep changes focused. Describe the problem, resulting behavior and checks run. Preserve validation, record-version checks, idempotency and data migrations. Use existing components and dependencies where possible. Include applicable notices when bringing in third-party code or assets. Current documents describe the supported behavior; earlier prototypes and design alternatives are not kept.

Contributions to Polaris are provided under [AGPL-3.0-only](LICENSE), unless explicitly identified as third-party material under its own compatible license. Submit only work you have the right to contribute, and preserve third-party notices.
