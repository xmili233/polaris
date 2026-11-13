# Polaris

**Polaris helps you clarify your goals, evaluate strategies, and turn your decisions into action.**

Work with a main agent to shape your direction, let background agents research and execute, and make important choices through decision cards. Use it for projects, work, learning, and personal goals.

## Demo

Start with a situation you want to improve.

> I want to find the first users for my product. Help me figure out what to focus on.

The main agent helps you choose a goal, define success, and explore complementary strategies. Each adopted strategy gets its own column on the board. Background agents investigate next steps and bring choices back as decision cards. Your answers guide the next round of work.

<!-- Add a current English-language screenshot or short walkthrough using sample data before publication. -->

## How it works

1. **Share your context.** Describe your project, situation, or ambition. The main agent helps identify possible goals and recommends a direction.
2. **Define your goal.** Agree on the outcome, a sign of success, and the constraints and preferences that matter to you. Adopted plans are saved in your workspace.
3. **Choose your strategies.** Compare complementary approaches. The main agent explains how each contributes to the goal and suggests a practical first step.
4. **Review decisions.** Background agents research and carry out authorized work. Questions, tradeoffs, and requests for approval appear as cards in the relevant strategy column. When a column has no pending cards, an agent researches further decisions worth bringing to you.
5. **Keep moving.** After you confirm a card, the main agent applies the agreed changes and arranges the remaining work. Agents can schedule future follow-ups and recommend changes to the goal or strategy as new information emerges.

A shared knowledge library keeps useful facts available across tasks. You can inspect and correct those records as you work.

## Get started

### Download

Download the latest release for [Apple silicon](https://github.com/xmili233/polaris/releases/latest/download/Polaris-macOS-arm64.dmg) or [Intel](https://github.com/xmili233/polaris/releases/latest/download/Polaris-macOS-x64.dmg) Macs, open the disk image and drag Polaris into Applications. Every version, with its SHA-256 checksums, is on the [releases page](https://github.com/xmili233/polaris/releases). Releases are built by GitHub Actions from the tagged source, signed with a Developer ID and notarized by Apple.

To update, download the new version and replace the app in Applications. Your workspace stays in place, and database upgrades make a verified backup first.

### Requirements

- macOS 15 or later, on Apple silicon or Intel.
- At least one supported agent client installed and signed in on your Mac — Codex, Claude Code, or Gemini CLI.
- Node.js 24 or later and pnpm 10, only when building from source.

### Agent clients

These are the versions accepted by the current Polaris adapters. Install and sign in through the native client before connecting it in Polaris.

| Client | Supported version | Install | Sign in |
| --- | --- | --- | --- |
| Codex CLI | 0.162.1 or later | `npm install -g @openai/codex` | `codex login` with ChatGPT |
| Claude Code | 2.1.312 or later | `npm install -g @anthropic-ai/claude-code` | `claude auth login` |
| Gemini CLI | 0.66.x | `npm install -g @google/gemini-cli@0.66.0` | Run `gemini`, then choose Sign in with Google |

Account eligibility, usage limits and supported models belong to the provider. Polaris uses native sign-in rather than API billing keys. Browser automation requires a separately configured browser tool; Polaris can discover `ego-browser` and native client tools, but does not include a signed-in browser. See the [user guide](docs/app-guide.md#connection-troubleshooting) for connection problems.

### Build from source

```sh
git clone https://github.com/xmili233/polaris.git
cd polaris
./macos/scripts/build-app.sh
open macos/build/Polaris.app
```

The build script installs workspace dependencies and creates `macos/build/Polaris.app`. You can copy the app to `/Applications` for regular use.

On first launch, connect an available agent and describe what you want to achieve. Polaris opens a local workspace. Sign-in and usage limits are managed by your selected agent provider.

The interface supports English, Simplified Chinese, Traditional Chinese, Japanese, Korean, French, German, Spanish, and Brazilian Portuguese. Choose your language in Settings.

## Data and execution

Goals, strategies, decision cards, conversation history, knowledge, and task records are stored on your Mac. The default workspace is located at `~/Library/Application Support/Polaris Desktop/Workspace/`.

Your selected agent provider processes the task context sent to it. Agents may access websites, local files, and connected tools as part of authorized work. You decide which goals and strategies to adopt and approve actions that require your judgment.

Native Agents run with broad local execution access: Codex uses full access, Claude Code selects bypass-permissions mode when available, and Gemini uses YOLO mode. Decision cards record business choices and approval; they do not sandbox filesystem or network access. Read the [execution boundaries](SECURITY.md#execution-and-data-boundaries) before connecting accounts or sensitive tools.

Background work and scheduled tasks require Polaris to be running and your Mac to be awake. Closing the window keeps the application running. Agent activity and pending work are restored from the local workspace when the app starts again.

## Development

Polaris uses Electron, React, TypeScript, and SQLite in a pnpm workspace. The desktop app and local service live in `desktop/`, the informational website lives in `web/`, and UI translations live in `packages/i18n/`.

From the repository root, start the desktop with a separate development workspace.

```sh
pnpm install --frozen-lockfile
pnpm --filter polaris-desktop dev -- --database /tmp/polaris-dev/polaris.sqlite
```

Run the same verification as CI, including builds and isolated UI tests.

```sh
pnpm verify
```

Further documentation is available in the following guides.

- [Desktop development and verification](desktop/README.md)
- [Local CLI reference](docs/cli.md)
- [User guide](docs/app-guide.md)
- [Architecture](architecture.md)
- [Contribution guide](CONTRIBUTING.md)

## Contributing

Use [GitHub Issues](https://github.com/xmili233/polaris/issues) to report bugs or propose improvements. For a bug report, include your macOS version, agent client, steps to reproduce, and the expected and observed behavior.

Issues are also a place to discuss the intended behavior of substantial changes. Keep pull requests focused and describe how you verified the result. The [contribution guide](CONTRIBUTING.md) covers isolated workspaces, checks and translations. Report security concerns using [SECURITY.md](SECURITY.md).

## License

Copyright (c) 2026 Polaris contributors.

Except where otherwise noted, Polaris is licensed under the **GNU Affero General Public License v3.0 only** (`AGPL-3.0-only`). See [LICENSE](LICENSE) for the full terms.

- Commercial use, modification and redistribution are permitted under the license.
- Redistribution must preserve the required notices and comply with the license's source-code requirements, including providing Corresponding Source when distributing binaries.
- If you modify Polaris and let users interact with that version remotely over a network, you must offer those users its Corresponding Source as required by Section 13.

Third-party components and assets retain their respective licenses. See [Third-party notices](desktop/THIRD_PARTY_NOTICES.txt) and the [launch media attributions](video/launch/assets/audio-attribution.md). This summary does not replace the license terms.

OpenCode setup, execution boundaries and verification: [OpenCode integration](docs/opencode.md).
