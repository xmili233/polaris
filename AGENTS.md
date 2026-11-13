# Polaris

Read README.md, architecture.md and docs/cli.md for the product and command contract.

The desktop coordinates native Agent sessions, task execution, MCP tools and independent scheduled tasks. Use the built-in Agent for planning, decisions and execution. The CLI supports local inspection and knowledge maintenance.

The Electron window, isolated preload, React UI, utility-process service and CLI live in desktop/. The renderer must use the private bridge for database access, commands and credentials. The service uses Node's built-in SQLite. Workspaces stay local; the desktop has no Polaris account gate. web/ contains the multilingual informational website with no account API. Use the pnpm workspace and its single lockfile for the application.

Build and run this repository independently of adjacent checkouts. The app is macos/build/Polaris.app. Signed, notarized releases come from .github/workflows/release.yml; CONTRIBUTING.md describes releasing and its secrets. The CLI is named polaris. The default data directory is ~/Library/Application Support/Polaris Desktop/Workspace. Tests must use isolated data. User-authorized data moves require a verified backup. Keep user data and credentials out of build artifacts. See CONTRIBUTING.md for verification and SECURITY.md for native execution boundaries.

## Language boundaries

- Write AI-facing instructions in English only. This includes AGENTS.md, setup API instructions, copied setup prompts, and CLI protocol documentation and diagnostics. Maintain one English source for each instruction. Keep these strings outside UI translation catalogs and independent of the selected interface language.
- Localize user-facing desktop and website UI through packages/i18n/locales/, using English as the authoring baseline. New or changed UI text needs stable semantic keys, named variables, supported plural forms and all nine translations. Run pnpm i18n:check. Keep generated legacy localization files out of the project.
- Classify text by its intended reader. An English prompt remains AI-facing when displayed for review or copying. Its button, label, description and feedback are user-facing UI.
- Preserve the language of user-authored goals, decisions, knowledge, quotes and imported material. Write conversational replies and new business content in the user's requested language. Interface language changes must preserve business records.
- Service errors retain English raw diagnostics and compatible error codes and fields. UI presentation uses messageKey and params to provide localized recovery information. Tool activity remains English.
- Maintain current contributor and user guides in English. Deliberately retained translations, historical records and user-authored material keep their source language. AI instructions embedded in them follow the English-only rule.

## Tests must respect the user's desktop

- Run UI, screenshot and animation tests in hidden, non-focusable windows using POLARIS_TEST=1.
- If a visible test window is necessary, use showInactive() and keep it non-focusable. It must stay clear of the user's active workspace. Use a hidden window or arrange a test time if this cannot be guaranteed.
- Tests must not call show(), focus() or bringToFront(), or send input to the user's current application. DOM focus and input targeted at an isolated test page are allowed.
- Native menu focus, global shortcuts and full-screen tests require the user's agreement before taking the foreground. Restore the user's working state afterward.
- Label hidden-window timing measurements accurately. They do not establish foreground frame rate. These restrictions apply to tests, while normal app launch follows the product's expected window behavior.

## Design context

Before changing UI design, styles, pages or design rules, read the effective summary in design.decisions.md, followed by the relevant sections of design.md and interaction.md. Desktop visual values belong in desktop/src/theme.css. Web reuses these values and keeps page-specific dimensions in web/app/theme.css. Keep the implementation in Electron and React.

Restore this context after a new session, compaction or handoff. Read unchanged material once per context. Record new user design decisions before synchronizing the affected guidelines, theme, interactions and implementation. Keep local decisions within their stated scope, and preserve the priority of explicit user instructions. Ordinary backend work requires no design exploration.
