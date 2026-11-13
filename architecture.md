# Architecture

[README](README.md) describes the product. This document describes the current runtime and data contracts.

## Runtime boundaries

```text
React → isolated preload → Electron main process → utility-process service → SQLite
                                                          ↓
                                          Codex / Claude Code / Gemini CLI
                                                          ↓
                                             Task-scoped Polaris MCP tools
```

| Location | Responsibility |
| --- | --- |
| `desktop/electron/` | Windows, menus, file dialogs, clipboard, workspace selection and process lifecycle. Validates IPC senders and methods. |
| `desktop/src/` | Board, main chat, read-only task details, knowledge library and settings. No direct Node.js, database or credential access. |
| `desktop/service/host.ts` | Private service entry point. `desktop-contract.ts` defines validated method inputs and replies. |
| `store.ts`, `migrations.ts` | Business records, record versions, idempotent writes, transactions and database upgrades. |
| `agent-coordinator.ts` | Native sessions, queues, concurrency, cancellation and recovery. |
| `agent-store.ts`, `agent-runs.ts` | Work, messages, inputs, decision provenance and execution evidence. |
| `agent-actions.ts`, `agent-instructions.ts` | Business tools, scope checks and the shared English Agent instructions. |
| `strategy-schedule.ts`, `strategy-state.ts` | Independent scheduled tasks and board state derived from stored records. |
| `knowledge.ts`, `execution-inputs.ts` | Versioned knowledge and explicitly bound knowledge or artifact inputs. |
| `cli.ts` | Local inspection and knowledge maintenance through the same storage layer. |

The native clients provide research, filesystem, command and connected-tool capabilities. Polaris manages plans and task lifecycles. The main conversation is serial. Up to five background tasks may run concurrently, with serial input within each native session.

## Plans, decisions and work

A goal contains an outcome and optional constraints and preferences. Strategies belong to a goal; decision cards belong to a strategy. Discussion and recommendations become records only when the user adopts them.

1. The main Agent helps the user choose a goal, discuss constraints and adopt at least three distinct strategies, unless the user deliberately chooses fewer. Saving a strategy enables decision research. Authorized execution starts through `run_strategies` or `start_work`; future work uses separate scheduled tasks.
2. Background tasks research or execute. They use `request_decisions` when they need the user. Cards can have options or accept a written answer. A strategy and question identifier have at most one pending card.
3. Confirmation records the answer and queues its handoff to the main Agent in one transaction. The main Agent reads the current plan, applies accepted changes with version checks and delegates remaining work. Cards contain no executable plan-edit instructions.
4. A task receives its instruction, current scoped context, linked knowledge and explicit inputs. Progress is an internal checkpoint; files and the final summary are task results.
5. Confirmed decisions are read-only. Reading history never repeats their actions.

A task completes the work it can do now, submits a card when it needs a person, or schedules a future task when time must pass. There is no separate strategy wait state or mandatory finish tool.

`get_context` returns a goal index, the selected goal's board, work, inputs, activity, schedules, pending questions, knowledge and run summaries. Without a selected goal, the main conversation receives `board: null`. Background context is limited to its goal and strategy. Stable context and live activity are computed separately; resumed sessions do not receive unchanged context again. New business content follows the user's language, regardless of the language of internal instructions or sources.

Knowledge updates preserve omitted fields. Category, tags and aliases are optional. New background knowledge is linked to its task's goal. Sources, rules versions, record versions and visibility are validated by the service.

## Scheduling and recovery

Every active strategy automatically prepares cards when its pending column is empty. There is no toggle. After any decision handoff finishes, an independent research task can prepare up to three supported decisions. It may run alongside ordinary execution. Consuming the trigger and queuing the task are atomic. Each empty cycle starts at most one round; pending cards must appear before another cycle can be armed. Research tools are restricted to reading and submitting cards.

A strategy may have multiple named scheduled tasks. Each has instructions, inputs and a one-time, daily, weekly or monthly schedule. The default time zone is the device's zone; an actual deadline may be specified. The main Agent and a background task within the strategy may manage schedules, subject to the user's authorization for the action and recurrence.

After sleep or app downtime, only the latest missed occurrence runs. Busy queues retain their due work; transactions and unique keys prevent duplicate dispatch. Changing or cancelling a schedule cancels unstarted work from its old version. Already-running work must be stopped separately.

The board and plan queries derive states from the same records, including pending decisions, review needed, running, queued, waiting for connection, missing inputs, scheduled and stopped. The rail keeps active work and exceptions needing attention. Finished tasks leave the rail and close their detail panels; their cards and stored results remain available. Strategy records show the strategy text and confirmed decisions.

Quitting stops managed runs. A request known to have stopped may resume in its native session after checking progress. Uncertain delivery is never blindly replayed. The main Agent receives one read-only verification task, inspects actual effects and records its conclusion with `resolve_run`. It schedules only remaining authorized work. Missing facts are requested through ordinary cards. Verification does not clear unrelated tasks or schedules.

## Agent permissions

The renderer's isolation and business MCP scopes do not sandbox the native Agent process. Codex runs with `approvalPolicy: never` and `sandbox: danger-full-access`. Claude Code selects `bypassPermissions` when available; Gemini uses `yolo`. Native clients can use the operating-system permissions of the user running Polaris.

Decision cards communicate user intent and approval for business actions. They are not an operating-system security boundary. Provider-required permission requests are still handled: the main chat presents them, while background work requiring an unavailable permission stops for recovery. Polaris does not manufacture approval responses.

Native sign-in stays with the provider client. Known API billing environment variables are removed from the child environment. Task context and tool results may be sent to the selected provider. See [security](SECURITY.md) and the [user guide](docs/app-guide.md) for the practical boundaries.

## Data and upgrades

The default workspace directory is `~/Library/Application Support/Polaris Desktop/Workspace/`. `workspaces.ts` preserves previously selected account workspaces in place. The current local selection is stored alongside the base database; the CLI can open another workspace with `--database`.

Schema version 5 upgrades versions 2, 3 and 4 once. Before modification, it creates and verifies a consistent SQLite backup. Failed upgrades roll back; unsupported versions are rejected. Migration preserves confirmed outcomes and original revisions, converts former strategy waits to independent one-time schedules, merges former policy records into goal constraints, and combines old card summary/background fields into the body. Removing a dependency never grants permission to execute. Already-received actions are not replayed.

New databases contain no demo data. Fixtures live only in tests. New Markdown exports use `polaris-knowledge:v1`; imports also recognize the former `resolve-knowledge:v1` marker so existing exports retain identity and version checks. Saved tool activity may contain the former MCP name; new sessions use `polaris`.

Change tokens avoid refreshing unchanged snapshots. Agent activity uses lightweight summaries; closing the main chat stops loading the full conversation. Polling still detects legitimate CLI writes.

## Website and verification

`web/` is a multilingual informational website with no account API. UI translations are shared through `packages/i18n/` with English as the authoring baseline.

Tests use isolated databases and native protocol fixtures. Electron UI tests run hidden and non-focusable with `POLARIS_TEST=1`. Real-model behavior requires a separate, explicitly authorized evaluation. Build artifacts must not contain user databases or credentials. See [contributing](CONTRIBUTING.md) for the verification commands.
