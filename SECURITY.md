# Security

## Reporting a vulnerability

Use the repository's Security tab → Report a vulnerability when private reporting is available. Include the affected commit, native client versions, impact and a minimal reproduction using fictional data. Do not include access tokens, cookies, personal conversations or a real workspace database.

If private reporting is unavailable, open an issue requesting a private contact channel without exploit details or sensitive attachments. Wait for that channel before sharing the reproduction. Ordinary bugs belong in public Issues. GitHub describes the private reporting process in its [documentation](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/report-privately).

## Execution and data boundaries

Polaris is a local desktop coordinator for native Agent clients. Its renderer has no direct Node.js, SQLite or credential access. A validated private bridge connects it to the local service. Business MCP tools validate the current task's record scope, versions and request identity.

Native Agents are separate processes with broad access. Codex runs with `danger-full-access` and no routine approval prompts. Claude Code selects `bypassPermissions` when available; Gemini uses YOLO mode. These processes can access local files, execute commands and use connected services with the operating-system permissions of the user. A task's business-record scope is not a sandbox for native filesystem or network tools.

Decision cards record business choices and authorizations. They do not technically isolate external actions. Mandatory provider permissions are not fabricated: main chat presents them and background tasks requiring unavailable permission stop. External content and imported documents can be untrusted inputs to an Agent.

Workspace records and attachments are stored locally. The selected AI provider processes supplied messages, relevant context and tool results; its own retention and account terms apply. Browser tools can operate signed-in websites. Polaris does not provide a cloud account or automatic workspace sync.

Native clients own authentication. Polaris removes known API billing environment variables before launching them, but their own configuration and connected tools still determine access. Protect the Mac account and provider credentials. Do not attach production workspaces to bug reports.

## Verifying a download

Releases are built from the tagged source by GitHub Actions, signed with a Developer ID and notarized by Apple. To check a download, compare its checksum with `SHA256SUMS` on the release page, then confirm the signature and notarization:

```sh
shasum -a 256 Polaris-macOS-arm64.dmg
spctl --assess --type execute --verbose=2 /Applications/Polaris.app
codesign --verify --deep --strict --verbose=2 /Applications/Polaris.app
```

## Testing security changes

Reproduce issues with temporary databases and protocol fixtures. Keep failed validation, scope checks, version conflicts and uncertain-delivery signals visible. Do not use another person's account or a live external action to prove a fix. See [CONTRIBUTING.md](CONTRIBUTING.md) for isolated verification commands.
