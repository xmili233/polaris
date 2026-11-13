# OpenCode

Polaris supports OpenCode 1.x from 1.15.5 for main and background Agents through native ACP. Install and configure a model provider before selecting an OpenCode model in the existing model menu:

```sh
npm install -g opencode-ai@1.15.5
opencode auth login
```

Polaris finds OpenCode on PATH or in `~/.opencode/bin`. OpenCode owns provider credentials and billing; configured providers may use API charges. A successful ACP connection and model listing do not verify credentials or quota. Authentication and access must be confirmed by a real prompt.

## Execution

Polaris starts `opencode acp` directly. ACP carries prompts, streaming responses, model options, cancellation and session restoration. The Agent uses the existing task-scoped Polaris MCP tools to create decision cards and update authorized business records. The `polaris` CLI remains for local inspection and knowledge maintenance.

Main and background models use the existing model selector. Background conversations remain read-only; questions use decision cards. OpenCode receives a separate process and working directory per session because its injected MCP configuration is directory-scoped. Resumed sessions receive the current scoped MCP server.

OpenCode's `build` agent receives a per-process `OPENCODE_PERMISSION` policy allowing tools while denying native `question` prompts. Global permission settings stay unchanged. Native processes have broad filesystem and network access; decision cards record business approval and are not a sandbox. Mandatory provider permission requests remain visible in main chat, while background tasks that cannot obtain permission stop for recovery.

## Real OpenCode protocol check

After building the desktop, run the installed OpenCode 1.15.5 binary against a local model fixture:

```sh
POLARIS_TEST_OPENCODE=/absolute/path/to/opencode node desktop/tests/opencode.integration.mjs
```

This checks discovery, model selection, streaming, session restoration, scoped business MCP cards, concurrent background scopes, provider failure/retry and cancellation. It uses temporary XDG directories and a local HTTP model server, without loading provider credentials or spending model quota. It verifies the real client protocol, not remote authentication or model quality. OpenCode 2.x is not supported by this adapter until separately validated. OpenCode 1.15.5 can send final stream updates after `end_turn`; Polaris waits for 250 ms of quiet, failing if updates continue beyond three seconds. It can also return `end_turn` without forwarding a provider error. Polaris rejects empty, zero-usage turns so they can be retried; failures after partial output may still lack a structured error and need inspection in OpenCode.
