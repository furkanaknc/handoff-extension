# Contributing

## Development setup

```powershell
npm install
npm test
```

## Local install in Cursor

```powershell
npm run install:local
```

Reload the window after installation.

## Expectations

- Keep handoffs deterministic: no extra model calls in the default path.
- Add or update tests for continuity, token budget, and repository payload behavior.
- Do not commit generated `dist/`, `node_modules/`, or `.vsix` files.

## Pull requests

1. Describe the handoff mode affected (`bootstrap`, `delta`, `recovery`, `repository-only`).
2. Include before/after token estimates when changing payload size.
3. Note any Codex routing or cross-platform behavior changes.
