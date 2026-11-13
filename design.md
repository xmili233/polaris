# Visual design

Read the [design decisions](design.decisions.md) first. Colors, dimensions, spacing and motion tokens belong in `desktop/src/theme.css`. The website shares the base values and keeps its page dimensions in `web/app/theme.css`.

## Principles

In the light appearance, use a white background, black and gray text, and blue for supporting states; the dark appearance follows the rules below. Establish relationships through placement, type size, weight and whitespace. Color communicates selection, focus, notifications and errors. Every element must help people understand, decide or complete a task.

Keep at most three text levels within a region: heading, body and secondary information. Group by spacing before adding borders or fills. State text describes the situation and available next step; errors retain recovery actions. Icons convey identity, category or state without repeating nearby text. Business content keeps its original language.

## Appearance

The desktop offers System, Light and Dark; System follows macOS. Colors are tokens in `desktop/src/theme.css`; `.theme-dark` restates every color token, including derived ones, so any subtree can render dark.

In dark, surfaces get lighter as they rise: `--background` for the window and full-window pages, `--surface` for lanes and rails, `--canvas` for cards, dialogs, popovers and inputs. Light keeps white for both `--background` and `--canvas`. Text is off-white with gray secondary text; blue is brightened for contrast; borders are translucent white; shadows recede, so separation comes from surface steps and hairlines. Ink-filled controls such as the selected goal and primary buttons invert, with `--on-ink` text; text on red or blue stays `--on-color` white. Ink-bodied avatars turn light with dark eyes.

The main process owns the appearance: it sets `nativeTheme`, which also themes the title bar, scrollbars and menus, gives the window a matching background so it never flashes white, and sends `config.dark` to the renderer.

## Window and board

The default window is 1440 × 1000, shrinking to the available screen area with a minimum height of 620. The left goal rail is 76 wide with a pale background. A selected goal uses a black surface and white icon. Goal icons come from the built-in Lucide catalog. Red number badges count pending decisions and disappear at zero.

The goal title has the strongest hierarchy, followed by its milestone and strategy columns. Constraints and preferences appear as persistent pale tags below the milestone, one per source paragraph. Overflow uses +N; opening a tag shows its full paragraph. Strategies keep record order, fixed column widths and vertical cards, including when there is only one strategy.

All active strategies prepare cards automatically. Empty columns show Nothing to decide, a card-preparation state or necessary recovery information. During research, show Preparing decision cards. Ordinary task titles and progress belong in the right-side Agent details. A future schedule shows its next time; stopped or scheduled-only strategies offer Continue.

Knowledge and settings entries sit at the bottom left. The strategy-title dialog shows its body followed by confirmed decisions separated by thin rules. Each historical entry shows the question, confirmation time and answer, newest first.

## Decision cards and dialogs

A title asks one direct question. The body contains only facts, deadlines and uncertainty that change the choice; the board preview comes from its first paragraph. Options have parallel short labels and one sentence explaining the key consequence. Recommendations state the decisive reason. Input bindings, internal IDs and file lists are not default content. Necessary sources use descriptive link titles.

The dialog expands from its card toward the center, normally 880 × 580 with at least 48 of clearance on small windows. The left side shows the question, brief context and any exact text needing approval. The right side contains options, a custom answer and confirmation. Selected options use a pale blue fill, fine border and check mark. Focusing an empty custom field preserves the current selection; typing changes it to a custom answer.

Options are optional and every card accepts a written answer. Submission requires one option or nonempty text. Proposed plan changes and approval scope are stated in the body, option details or quoted text. Confirmed records are read-only and cannot be withdrawn.

## Agent rail and chat

The fixed rail places the main Agent above a divider and background entries below it. Use the approved Open Bot Avatar catalog. The main Agent always gets the first design; background selection is stable by session key and avoids it. Small avatars do not follow the pointer.

The main entry has a white rounded plate and a dot for an unread reply. Running tasks use a rotating progress arc; queued or disconnected tasks use a stationary dashed ring. Finished tasks disappear. Failed or uncertain work uses an orange exclamation mark. Avatars stay still when hidden, occluded or reduced motion is enabled.

Chat and task details dock to the left of the rail and align with its top and bottom. The selected plate moves between entries. Main chat accepts input; background details are read-only chronological activity, artifacts and related cards. While a task is visible, its answer is grouped into collapsed activity if pending cards already carry the interaction. Status appears under the title without another result panel.

The rounded composer contains text above an action row: attachments left, model and send/stop right. The initial placeholder is Share an idea or ask a question, localized through its semantic key. Full-window chat and composer share a maximum width of 736, with 40 of space after messages. Hide only the main chat scrollbar appearance; retain scrolling and the scroll-to-bottom action.

Tool activity summaries and titles stay English; input and output retain their original text. Activity defaults to collapsed and the final answer takes priority. Streaming never closes a section the user opened. Messages remain selectable. Recoverable background failures show Retry beside their error. Polaris-owned permission titles and buttons are localized; provider content stays intact.

## Models, schedules and knowledge

The model menu opens upward, aligned to the composer's right edge. Its left side has search and provider groups; the right side shows only supported reasoning and speed settings. Save the model and its settings together, retaining each model's last selection.

Settings contain General and Model. The main model uses the same selector as chat. Background model settings sit directly below it and can follow the main model or be independent. Language changes apply immediately without restarting sessions. Nine catalogs use stable keys and named variables; long labels must not cover actions in compact windows.

A clock marks strategies with future work. The main chat can inspect, change or cancel schedules; task details can stop a running task.

The knowledge library occupies the board area with list, reading and editing states. Switching goals must not discard drafts. Version conflicts need a recovery path. Internal record identifiers are not reading content.

## Website

The landing page uses a near-black canvas with light text, following the user's Linear reference. Each section has one large headline, a lead phrase in primary text followed by secondary text, and either a four-column feature row or a two-column split divided by hairlines. Section bands separate through slight tone changes, not cards or borders. Frequently asked questions use native disclosure rows between hairlines, with the first answer open; facts such as supported client versions come from the code rather than copy. Do not add eyebrow labels, customer logos or claims the product cannot support.

Product views show the app in its dark appearance, using the desktop's dark tokens through `body.theme-dark`. They are built from the shared desktop tokens rather than screenshots so all nine languages render natively; demo content is fictional and matches the launch film. Views sit flat and front-facing, sized so their text stays readable, and may be cropped with a fade into the page instead of a hard edge. Do not tilt them in perspective or darken them with overlays. Tool activity stays English.

The header sits transparently on the page with no divider and scrolls away with it. It holds the brand, the guide link, a round ghost globe button whose native menu lists the languages, and the GitHub pill; narrow screens drop the guide link. Buttons are pills with press feedback; an arrow inside one moves slightly on hover where a fine pointer exists and motion is allowed.

The primary action downloads the Apple silicon build; a line beneath states the requirement and links the Intel build by name, because browsers cannot tell the two apart. Building from source is secondary. Use the platform font stack. Web-only colors, type scale and page dimensions live in `web/app/theme.css`. Motion only explains product behavior: running Agents show their progress arc, and the preparing column shows its cards arriving while it scrolls into view where the browser supports scroll-driven animation. No decorative entrance or reveal motion. Reduced motion keeps the final state. On narrow screens, product views crop rather than shrink below legibility.

## Motion

Use the existing theme timings: overlay entry/exit 200/140 ms, conversation 240/170 ms, content replacement 100 ms out then 180 ms in, list insertion/removal 220/160 ms, and press feedback 140 ms. Card-to-dialog transitions preserve spatial continuity without double surfaces or text reflow.

Reduced motion retains state feedback while removing movement, scale, shimmer and rotation. Focus, interruption and trigger behavior follow the [interaction contract](interaction.md).
