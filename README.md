# Cursor Codex Handoff

A small Cursor extension that transfers visible conversation text and
deterministic repository state between Cursor Agent and the official OpenAI
Codex extension. It does not add a chat UI, invoke a routing model, require an
API key, or install a separate Codex CLI.

## Commands

```text
Handoff: Cursor → Codex
Handoff: Codex → Cursor
```

### Cursor → Codex

On first use, the extension asks permission to add two command hooks to the
user-level `~/.cursor/hooks.json`. Existing hook configuration is preserved and
backed up. The hooks store only the active conversation ID, workspace path, and
Cursor-provided transcript path under extension storage; transcript content is
not copied or logged by the hook.

The command parses visible user/assistant text, captures optional Git context,
writes a temporary Markdown handoff, and attaches it to the active Codex thread
with `chatgpt.addFileToThread`.

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
npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository -o cursor-codex-handoff-0.0.4.vsix
cursor --install-extension .\cursor-codex-handoff-0.0.4.vsix --force
```

Run `Developer: Reload Window` after installation, then invoke either handoff
command from the Command Palette.

## Settings

- `handoff.maxConversationMessages`: default `200`
- `handoff.maxConversationCharacters`: default `200000`
- `handoff.maxDiffBytes`: default `102400`

Git context is optional. A folder that is not a Git repository can still be
handed off.

## Current boundaries

- Windows-first local milestone
- No automatic model submission
- No status bar or keyboard shortcut
- No history-delta optimization
- No undocumented Cursor SQLite conversation source
