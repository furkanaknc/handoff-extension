# Cursor Codex Handoff

A Cursor extension that transfers visible conversation text and deterministic
repository state between Cursor Agent and the official OpenAI Codex extension.
It does not add a chat UI, invoke a routing model, require an API key, or
install a separate Codex CLI.

## Commands

```text
Handoff: Cursor → Codex
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

Repository context defaults to branch, HEAD, changed files, and diff stat.
Full diffs are omitted unless `handoff.includeFullDiff` is enabled because both
agents usually share the same workspace.

## Development

```powershell
npm install
npm test
npm run install:local
```

Run `Developer: Reload Window` after installation.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## Settings

- `handoff.maxHandoffTokens`: default `6000`
- `handoff.maxConversationTokens`: default `4500`
- `handoff.includeFullDiff`: default `false`
- `handoff.includeCodexCommentary`: default `false`
- `handoff.codexRoutingTrust`: `auto` | `always` | `never`, default `auto`
- `handoff.maxDiffBytes`: default `102400` (only when full diff is enabled)
- `handoff.maxStoredHandoffs`: default `5`
- `handoff.maxConversationMessages`: deprecated hard cap
- `handoff.maxConversationCharacters`: deprecated hard cap

## Current boundaries

- Cross-platform Codex app-server discovery is supported when the official
  extension ships a matching bundled binary
- Codex routing verification uses capability probing with optional trust overrides
- No automatic model submission
- No keyboard shortcut

## Implementation note

Provider adapters capture conversations or attach Markdown. The sync planner
sits between capture and rendering, while a workspace-scoped atomic state store
is updated only after the target adapter reports successful attachment.
