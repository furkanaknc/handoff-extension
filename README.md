# Cursor Codex Handoff

A Cursor extension that transfers visible conversation text and deterministic
repository state between Cursor Agent and the official OpenAI Codex extension.
It does not add a chat UI, invoke a routing model, require an API key, or
install a separate Codex CLI.

## Commands

```text
Handoff: Cursor → Codex          Ctrl+Shift+H / Cmd+Shift+H
Handoff: Codex → Cursor
Handoff: Preview Cursor → Codex
Handoff: Preview Codex → Cursor
Handoff: Reset Sync State
Handoff: Show Sync Diagnostics
Handoff: Open Control Center
```

The status-bar `Handoff` button opens a control center with binding state,
transfer actions, previews, diagnostics, and reset.

## Handoff modes

- `bootstrap`: bounded self-contained working set for a new target
- `delta`: only new conversation since the last verified transfer
- `recovery`: bounded restart when continuity cannot be trusted
- `repository-only`: repository metadata changed, no new conversation

Typical token sizes:

- bootstrap/recovery: about 4k–6k estimated tokens
- delta: often under 3k estimated tokens

Full source history stays on disk in Cursor/Codex transcripts. The extension
stores only sync metadata and recent handoff manifests locally.

## Stateful synchronization

Sync metadata is stored in extension global storage, never in the repository.
Delta sync uses source checkpoints based on recent message anchors, so sliding
parser windows do not force unnecessary bootstrap handoffs.

Repository context in exported handoff Markdown defaults to **branch and HEAD**
only. Changed-files lists and diff stats are used internally for sync planning
but are not included in the model-facing export unless you enable a full diff.

## Development

```powershell
npm install
npm test
npm run install:local
```

Run **Developer: Reload Window** after installing or updating the VSIX.
Cursor hook config reloads automatically when `hooks.json` is written.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## Settings

- `handoff.codexTarget`: `bound` | `new` | `active` | `ask`, default `bound`
- `handoff.skipAttachmentConfirmation`: default `false`
- `handoff.autoInstallHook`: default `true`
- `handoff.maxHandoffTokens`: default `6000`
- `handoff.maxConversationTokens`: default `4500`
- `handoff.includeFullDiff`: default `false`
- `handoff.includeCodexCommentary`: default `false`
- `handoff.codexRoutingTrust`: `auto` | `always` | `never`, default `auto`
- `handoff.maxDiffBytes`: default `102400` (only when full diff is enabled)
- `handoff.maxStoredHandoffs`: default `5`
- `handoff.maxConversationMessages`: deprecated hard cap
- `handoff.maxConversationCharacters`: deprecated hard cap

## Known limitations

### Cursor hook

- First use installs a local hook in `~/.cursor/hooks.json` (with backup).
- Cursor reloads hook config on save; a full window reload is only needed after installing or updating the VSIX.
- The hook captures conversation ID and transcript path only after you send **at least one** Cursor Agent message in the workspace.

### Codex thread routing

- Deterministic thread routing depends on the official Codex extension and its bundled app-server binary.
- Unknown Codex versions are probed at runtime; verified versions are allowlisted in the extension.
- `thread/start` is an experimental app-server method. When it fails, handoff falls back to `chatgpt.newChat` without a thread ID, so the first transfer stays bootstrap-only until you pick or bind a thread manually.

### Manual submit

- Handoff attaches a Markdown file to the target composer via `chatgpt.addFileToThread` (Codex) or Cursor's attachment command.
- There is no public `chatgpt.submit` or Cursor composer submit API. You still press Enter to send the attached context.

### Session binding

- With `handoff.codexTarget: bound` (default), repeat handoffs reuse the stored Cursor conversation ↔ Codex thread pair when `thread/read` confirms the thread still exists.
- Threads created via app-server may not appear immediately in `thread/list`; bound selection uses `thread/read` as a fallback.
- Reset binding via **Handoff: Reset Sync State** or the Control Center.

## Implementation note

Provider adapters capture conversations or attach Markdown. The sync planner
sits between capture and rendering, while a workspace-scoped atomic state store
is updated only after the target adapter reports successful attachment.
