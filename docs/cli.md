# CLI contract

The CLI and desktop share local SQLite storage. The CLI can inspect a workspace and maintain its knowledge library while the app is closed. Use the built-in Polaris Agent for goals, strategies, decision cards and execution.

## Location and input/output

The command is `polaris`. When it is absent from PATH, use the bundled executable at `Polaris.app/Contents/Resources/bin/polaris`; for an app in `/Applications`, see the [user guide](app-guide.md#connection-troubleshooting).

Each command accepts a leading `--database /absolute/path/polaris.sqlite`. By default it uses the selected local workspace. Previous account databases stay in place; the local selection is stored in workspace.json beside the base database. The base path is `~/Library/Application Support/Polaris Desktop/Workspace/polaris.sqlite`. Tests must use a temporary database.

- Success writes one JSON value to stdout and exits 0. Help is plain text and `knowledge export` writes Markdown.
- Failure writes `{"code":"...","message":"..."}` to stderr. Exit 2 indicates input or usage, 3 indicates a missing record, 4 indicates a conflict, and 1 indicates other failures such as storage or migration.
- Writes read JSON from `--input file.json` or `--input -` for stdin, up to 1 MiB. Use safe shell quoting.
- Fields use camelCase. Timestamps use UTC ISO 8601.
- Knowledge saves require a request ID and the current record and rules versions. An identical retry returns its original result.

## Read

```sh
polaris status
polaris context
polaris context --goal growth
polaris goal list
polaris strategy list
polaris decision list
polaris outcomes
polaris outcomes --unacknowledged
polaris history policy policy-id
```

`context` returns `{board:{goals,strategies,decisions},outcomes,knowledge}`, including archived, cancelled and acknowledged history. Use `--goal` to narrow the goal. Entity `list` commands return active records, with the current outcome attached to decisions. `history KIND ID` returns entity versions. Goals carry optional `constraints`; decisions use `body`, optional `excerpt` and options. `history policy ID` can read original policy revisions preserved during migration; policies have no live list or write path. Read outcome history through `outcomes`.

Each outcome has an ID, decision ID, decision version and decision timestamp. An option choice includes `optionID`. A written answer is stored in `note`. Historical outcomes may include a withdrawal or receipt timestamp. Reading them leaves the stored status intact.

## Recovery

- For `conflict`, read current context and reconcile versions and outcomes. Use a new request ID for revised input and the original ID for an identical retry.
- For `not_found`, verify the database, ID and parent before creating a replacement.
- For `storage`, `schema` or `migration`, preserve the original files, stop writes and report the failure.

## Knowledge library

Use the library for reusable facts. Read the user's rules and existing records before saving. Record concrete sources and distinguish unverified information. Follow the rules for categories, tags and aliases. The user changes the rules in Polaris.

```sh
polaris knowledge rules
polaris knowledge list --query 'customer alias' --goal growth --offset 0
polaris knowledge get DOCUMENT_UUID
polaris knowledge save --input document.json
polaris knowledge history DOCUMENT_UUID
polaris knowledge import --input notes.md --goal growth
polaris knowledge export DOCUMENT_UUID > notes.md
```

- `list` accepts `--goal`, `--query` and `--offset` and returns `documents`, `total` and `nextOffset`. All whitespace-separated search terms must match. Search normalizes case and supports Chinese. `context` includes a bounded directory and rules. Read full bodies on demand.
- `save` updates only supplied fields; omitted fields retain their current values. New documents require `title`, `body` and `sources`. Category defaults to an empty string; tags, aliases and goalIDs default to empty arrays. Every save requires `expectedVersion`, `rulesVersion` and `requestID`. CLI writes require at least one source. Create with `expectedVersion: 0` and no ID. Update with the ID and version from `get`. Read `rulesVersion` from `knowledge rules`.
- Limits are 160 characters for title, 80 for category and 200000 for body. Tags and aliases allow up to 20 entries of 80 characters. Sources allow up to 20 entries of 2000 characters. Provide up to 100 existing goal IDs. The document UUID is independent of its title and category.
- Reuse a document by linking multiple goal IDs. A shared edit affects all linked goals. CLI access is scoped to the local workspace.
- `history` returns metadata for up to 100 recent versions. The app can read historical bodies and restore one as a new version. Archive records and edit rules in the app.
- `import` reads UTF-8 Markdown from a file or stdin. Plain files create a new record. Same-workspace exports update the original ID with version checks. Cross-workspace exports create a new record associated only with the supplied `--goal`. Unknown frontmatter stays in the body.
- `export` writes Markdown with a `polaris-knowledge:v1` metadata comment containing workspace identity and version. Imports also accept existing `resolve-knowledge:v1` exports with the same validation. Each import and export is a discrete operation.
