# Using Polaris

Polaris helps you analyze goals and strategies, decide what matters and turn the direction you choose into results.

## Start a workspace

Download Polaris from the [latest release](https://github.com/xmili233/polaris/releases/latest), or build it using the [README](../README.md). No Polaris account is required. Connect an installed, signed-in Codex, Claude Code or Gemini CLI. The model provider manages your account, eligibility and usage limits. Choose main and background models in Settings → Model.

Describe an idea or ask a question. The main Agent answers and guides you through a goal, its constraints and preferences, and complementary strategies. It recommends at least three strategies where useful. Candidates become records only when you adopt them. You can choose fewer strategies, limit the work or ask to keep the conversation exploratory.

## Use the board

Goals appear on the left. Each strategy has a column of cards; Agents appear on the right. The first Agent is the main conversation for discussing direction, checking progress or changing plans. Background task details are read-only.

Read a card, select an option or write your own answer. If it requests a fact, supply that fact. If it requires an action only you can perform, complete the action and record the result. Before approving an external action, check its recipient and exact content. Confirmation hands the choice to the main Agent, which applies accepted changes and arranges work. A confirmed decision cannot be withdrawn; discuss a new direction with the main Agent if circumstances change.

Every active strategy automatically prepares new cards when its column has none pending. A background research round submits up to three supported decisions. Once the last card is confirmed and its answer is handled, another round can begin. Research may finish without a card when no useful decision is supported. Saving a strategy does not authorize external actions or create a schedule.

Click a strategy's title to read its description and past decisions. Click a constraint tag to read its full text. Settings → General also sets the appearance: System follows macOS, or choose Light or Dark. The interface language can change in Settings without rewriting your goals, cards or knowledge.

## Work and schedules

The main Agent starts authorized execution in the background. Tasks complete what can be done now. Work that must happen later becomes an independent scheduled task, such as checking for a reply tomorrow. A strategy can have several schedules. Recurring work needs your prior agreement. Ask the main Agent to inspect, change or cancel schedules.

A stopped strategy or one with only future work offers Continue. This starts current work while preserving its future schedule. Stopping a running task does not cancel its recurrence.

Open a background avatar to inspect its activity. Finished entries and their details close automatically; pending cards remain on the board. Failed or uncertain tasks retain recovery. Retry resumes supported interruptions. When an action's effect is uncertain, the main Agent checks what actually happened before arranging the remaining work.

Closing the window keeps Polaris running. Quitting, sleep and shutdown stop local execution; nothing runs in a Polaris cloud service. On restart, saved state is recovered and a missed schedule runs only its latest occurrence. Keep Polaris running and the Mac awake for time-sensitive work.

## Agent access and your data

Polaris launches native Agents with broad execution permissions. Codex uses full access, Claude Code requests its bypass-permissions mode, and Gemini uses YOLO mode. They can access files, commands and connected tools with your operating-system permissions. Decision cards record your intent and business approval; they do not create a filesystem sandbox. Provider-required permission prompts may still appear.

Your selected provider receives task messages, relevant context and tool results. Browser actions depend on the tools configured on your Mac. Polaris detects `ego-browser` when available, but it does not include a signed-in browser or guarantee that a website is ready. Other native browser tools may also be available.

Goals, decisions, conversations, attachments and knowledge are local. The default workspace is `~/Library/Application Support/Polaris Desktop/Workspace/`. App removal does not remove that directory. Existing workspaces are preserved during upgrades, and database migrations make verified backups before changing the schema. Use a separate workspace for experiments and preserve a backup before moving or deleting your own data.

The knowledge library contains reusable project facts. Read, edit, import/export Markdown or restore an earlier version. Resolve save conflicts by loading the latest record before editing again. For local inspection and explicit database selection, see the [CLI reference](cli.md). See [Security](../SECURITY.md) for reporting concerns.

## Connection troubleshooting

| Symptom | Check |
| --- | --- |
| Client not installed | Run the installation command from the [compatibility table](../README.md#agent-clients), then reopen Polaris or return to its connection screen. |
| Client version unsupported | Check `codex --version`, `claude --version` or `gemini --version`. Gemini support currently targets the 0.66.x line. |
| Not signed in | Sign in through the native client in Terminal, then reconnect in Polaris. A Polaris account is not needed. |
| Usage limit reached | Check the provider's reset time or account limits, then use Retry. Retrying does not restore provider quota. |
| Protocol failure after an update | Compare the client version with the supported range, reconnect, and report reproducible failures with versions and sanitized diagnostics. |
| Browser unavailable | Check the browser tool's own installation and login. Finding a CLI does not mean the browser or site is signed in. |
| No work while the app is closed | Closing the window is supported; quitting the app or sleeping the Mac stops background execution. |

The bundled local CLI is `Polaris.app/Contents/Resources/bin/polaris`. If Polaris is in `/Applications`, inspect it with:

```sh
"/Applications/Polaris.app/Contents/Resources/bin/polaris" status
```
