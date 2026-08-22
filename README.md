# Cursor Codex Handoff

A small Cursor extension that transfers visible conversation text and
deterministic repository state between Cursor Agent and the official OpenAI
Codex extension. It does not add a chat UI, invoke a routing model, require an
API key, or install a separate Codex CLI.

## Commands

```text
Handoff: Cursor → Codex
Handoff: Codex → Cursor
Handoff: Reset Sync State
Handoff: Show Sync Diagnostics
Handoff: Open Control Center
```

A single always-visible `Handoff` status-bar button opens a control center that
shows binding and last-transfer state for both directions. From the same menu
the user can start either transfer, open full diagnostics, or reset all
workspace handoff state. Transfers still never submit a model turn.

## Stateful handoff synchronization

Sync metadata is stored locally under the extension's global storage, never in
the repository. The first safe transfer is full. Later Codex → Cursor transfers
may contain only new visible messages, or only repository changes, when the
source history prefix and the exact receiving Cursor conversation both match
the previous successful transfer. If nothing changed, no file is created.

The active Codex sidebar thread ID is not exposed reliably by the current
public extension interface. For verified Codex extension versions, Cursor →
Codex therefore asks the user to select a workspace thread, opens that exact
thread through the official extension's local URI handler, and requires an
explicit confirmation before attachment. The first successful transfer creates
a workspace-scoped binding; later transfers to the same verified pair can use
delta synchronization. Unsupported Codex versions, shortened or mutated
history, missing/corrupt state, or unknown target identity always fall back to
full.

Binding and sync state advance atomically only after native attachment succeeds. The clipboard
fallback is useful for recovery but is not recorded as synchronized. Generated
Markdown carries inspectable provenance and is excluded from later exports to
avoid recursive handoff growth. `Handoff: Reset Sync State` deletes only the
active workspace's bridge metadata; the next transfer in each direction is
full.

### Cursor → Codex

On first use, the extension asks permission to add two command hooks to the
user-level `~/.cursor/hooks.json`. Existing hook configuration is preserved and
backed up. The hooks store only the active conversation ID, workspace path, and
Cursor-provided transcript path under extension storage; transcript content is
not copied or logged by the hook.

The command parses visible user/assistant text, captures optional Git context,
and lists matching Codex threads for the workspace. After the user chooses and
verifies the target, it writes a temporary Markdown handoff and attaches it with
`chatgpt.addFileToThread` without submitting a model turn.

### Codex → Cursor

The extension starts the official Codex extension's bundled app-server and
uses `thread/list` and `thread/read` to read visible user, commentary, final,
and plan text for the active workspace. If multiple Codex threads match, it
asks which one to use.

It renders the conversation and current Git state to Markdown and attaches the
file to the selected Cursor Agent conversation. If the local Cursor attachment
command is unavailable, the Markdown is opened and copied to the clipboard as
a fallback.

Neither direction submits the prepared prompt or invokes a model.

## Development

Validated milestone environment:

- Windows
- Cursor 3.16.29
- Node.js 22 available on `PATH`
- Official `openai.chatgpt` extension installed in Cursor

Install and verify:

```powershell
npm install
npm test
```

Package and install directly into Cursor:

```powershell
npm run install:local
```

Run `Developer: Reload Window` after installation, then invoke either handoff
command from the Command Palette.

## Settings

- `handoff.maxConversationMessages`: default `200`
- `handoff.maxConversationCharacters`: default `200000`
- `handoff.maxDiffBytes`: default `102400`
- `handoff.maxStoredHandoffs`: default `5`

Generated handoff Markdown is automatically pruned to the configured newest
file count. Local development packaging overwrites the single
`cursor-codex-handoff-latest.vsix` artifact instead of accumulating one package
per version.

Git context is optional. A folder that is not a Git repository can still be
handed off.

## Current boundaries

- Windows-first local milestone
- No automatic model submission
- No keyboard shortcut
- Deterministic Cursor → Codex routing is version-gated against inspected
  official Codex extension builds; unverified builds remain full-only
- No undocumented Cursor SQLite conversation source

## Implementation note

Provider adapters still only capture conversations or attach Markdown. The
provider-independent sync planner sits between capture and rendering, while a
workspace-scoped atomic state store is updated only after the target adapter
reports successful attachment. This keeps session discovery in the adapters
and hashing, full/delta decisions, and repository fingerprints in the handoff
core.
