# Cursor Codex Handoff

A small Cursor extension that transfers the active native Cursor Agent
conversation and deterministic repository state to the official OpenAI Codex
extension. It does not add a chat UI, call a routing model, require an API key,
or install a separate Codex CLI.

## First milestone

This milestone exposes one command:

```text
Handoff: Cursor → Codex
```

On first use, the extension asks permission to add two command hooks to the
user-level `~/.cursor/hooks.json`. Existing hook configuration is preserved and
backed up before modification. The hook stores only the active conversation ID,
workspace path, and Cursor-provided transcript path under extension storage.
It never copies or logs transcript content.

After installation, send at least one message in Cursor Chat so the hook can
capture the active conversation. Run the handoff command again. The extension
will:

1. Parse visible user and assistant text from Cursor's JSONL transcript.
2. Capture Git branch, changed files, diff stat, and a size-capped diff when
   available.
3. Write a temporary Markdown handoff under extension global storage.
4. Attach it to the active official Codex thread with
   `chatgpt.addFileToThread`.

The handoff does not submit a prompt or invoke either model.

## Development

Requirements for the initial local proof:

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
npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository -o cursor-codex-handoff-0.0.2.vsix
cursor --install-extension .\cursor-codex-handoff-0.0.2.vsix --force
```

Run `Developer: Reload Window` from the Command Palette after installation.
Then run `Handoff: Cursor → Codex`. The included `.vscode/launch.json` remains
available for Extension Development Host debugging, but it is not required for
normal local use.

## Settings

- `handoff.maxConversationMessages`: default `200`
- `handoff.maxConversationCharacters`: default `200000`
- `handoff.maxDiffBytes`: default `102400`

Git context is optional. A folder that is not a Git repository can still be
handed off.

## Current boundaries

- Cursor → Codex only
- Active Codex thread only
- No status bar or keyboard shortcut yet
- No undocumented Cursor SQLite fallback
- No Codex → Cursor transfer yet
