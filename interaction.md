# Interaction contract

See [visual design](design.md) for presentation and [architecture](architecture.md) for runtime boundaries.

## Entry and navigation

Polaris opens a local workspace without a Polaris account. Existing business data stays accessible while Agents are disconnected. A new workspace detects Codex, Claude Code and Gemini CLI, preferring the last selected available provider, then the first available provider. Detection alone does not authorize queued work.

Missing or signed-out providers expose commands that can be copied. Recheck when the app returns to the foreground or while the connection page is visible; stop checking after leaving it. A successful connection opens main chat. Failures retain recovery. Without goals, main chat fills the window and uses the localized Share an idea or ask a question placeholder. The main Agent answers, then guides planning; only adopted goals are saved.

After the first goal is saved and the native turn actually ends, show the opening-board state and transition to the board. Preserve chat, drafts and attachments. Existing goals open directly on the board. Left-side icons or ⌘1…⌘9 switch goals and close the current decision dialog; the latest switch wins.

Constraint tags open read-only paragraph details. Overflow is available through +N, with arrow keys, Home/End and Enter. Escape, the close button or the backdrop dismisses details and restores entry focus. Goal changes close details. A strategy title opens its text and decision history.

## Decisions

Opening a card expands its dialog from the source position. Number keys 1…9 select options; numbers remain ordinary text when the custom input has focus. Selecting an option clears custom text. Typing custom text clears the option. Focusing an empty field changes neither.

Confirm or ⌘↩ submits one option or the exact custom answer. A card without options requires a written answer. Prevent duplicate submission while saving; keep the card and input on failure.

Save confirmation and queue main-Agent coordination in one transaction. Reject stale card versions and ask the user to refresh. Accepted plan changes later use the normal record-version checks. Confirmed decisions cannot be withdrawn. One confirmation handles one card and does not open the next automatically.

After confirmation the dialog fades out. History remains in strategy records and opens read-only, returning to strategy records on close. Viewing history never executes the decision again.

Escape, close or backdrop dismisses a dialog and returns focus to its source, or an appropriate list entry if the source disappeared. Background updates do not replace the version being confirmed. Text, code, tables and saved answers are selectable; wide content can scroll horizontally. Body links open on deliberate clicks. Option rows select without opening links.

## Main chat and background tasks

The first rail entry opens main chat; the others open read-only task details. Support arrow keys, Home/End and Enter/Space. Closing returns focus to the entry, preserves the draft and lets tasks continue. Replies completed while main chat is closed add an unread dot.

Enter sends and Shift+Enter inserts a line break. Enter during IME composition does not send. A turn can have up to ten attachments, each at most 20 MB; save local copies before sending. Attachment-only messages are allowed. Failures retain the draft. Send slash commands separately from attachments, offering only commands supported by the native provider.

Ordinary follow-up input can steer a running Codex turn when supported. Commands, messages with a changed model and other providers use the queue. Uncertain delivery must not be automatically resent. Stop only promises to stop Polaris-managed work, not every external process.

Background tasks accept no chat input. Facts, choices, approvals and actions only the user can perform all use decision cards. Cards may be confirmed independently; the main Agent handles their answers serially and delegates execution. The rail retains running, queued, disconnected and exceptional work. Completion removes the entry and closes its open details; pending cards and stored records remain.

Retry is available beside recoverable failures. Unsubmitted requests return to the queue. Submitted work known to have stopped resumes remaining work in its session; uncertain results are checked first.

Activity is collapsed by default when a final answer appears. Preserve manual expansion during streaming and do not force readers back to the bottom. Starting a new conversation preserves visible history while the next message uses new native context. Permission controls use the interface language; original provider content and commands retain their text and exact response IDs.

## Advancement, schedules and recovery

Background tasks complete work that can be done now, ask through cards when they need the user, and create independent scheduled tasks when time must pass.

All active strategies prepare cards automatically. An empty column can produce up to three supported cards in one round. After the last card is confirmed, the main Agent handles the answer before another round. Card research can run alongside ordinary execution. Archiving a goal or strategy stops further preparation.

Saving a strategy does not dispatch execution or a scheduled task. The main Agent explicitly starts work only when authorized. Multiple named schedules may belong to one strategy. The main Agent can inspect, change or cancel them. Stopping current work does not cancel a recurrence; archiving a strategy stops future dispatch. Recovery runs only the latest missed occurrence.

Stopped or scheduled-only strategies offer Continue for current work without altering existing schedules. Queued work, missing connections, missing inputs and uncertain outcomes retain distinct feedback. The main Agent checks actual effects before continuing uncertain work and asks for unavailable facts through cards. Execute only the remaining authorized work.

## Settings and knowledge

The bottom-left button, ⌘, and chat settings links open General or Model. General holds Language and Appearance; Appearance offers System, Light and Dark as radio choices, defaults to System, applies at once without restarting sessions, and keeps the language choice. A failed save keeps the previous appearance and shows a retryable message. Escape, close or backdrop dismisses settings; Tab stays within the dialog and focus returns to the entry. Changes apply immediately. Show the background model directly below the main model, with a follow-main checkbox or independent selection.

Model menus support search, Up/Down, Home/End and Enter. Right enters model options, Left returns, and Escape closes only the current menu. Pause sending while a model change is pending; preserve the previous model and draft on failure. Running and queued messages keep the configuration captured when sent. A background model change affects work that starts afterward.

The knowledge library remains mounted. Leaving a modified editor asks before discarding it. Saves check versions and never overwrite a conflict automatically. Restoring history creates a new version while retaining current visibility. Import/export uses system file dialogs; cancellation changes nothing. Only the user can change knowledge maintenance rules.

## Motion and accessibility

Card transitions use one moving surface, laid out at its final dimensions before animating transform and opacity. Closing mid-animation reverses from the current position; repeated close requests act once. Resize remeasures the target. Ordinary text wrapping does not trigger card arrival or list insertion motion.

Full-window main chat first contracts into its rail entry. Conversations enter from the rail side; switching entries replaces only the inner content. Reduced motion keeps opacity feedback and removes movement, scaling and rotation.

Exiting overlays accept no input. Local menus handle Escape before their containing dialog. Errors and states have accessible names and appropriate announcements. Hidden-window timing measurements do not establish foreground frame rate.
