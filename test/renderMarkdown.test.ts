import assert from "node:assert/strict";
import test from "node:test";
import { renderHandoffMarkdown } from "../src/handoff/renderMarkdown";
import type { HandoffContext } from "../src/handoff/types";

function context(overrides: Partial<HandoffContext> = {}): HandoffContext {
  return {
    source: "cursor",
    workspacePath: "C:\\work\\sample",
    conversation: {
      id: "conversation-id",
      truncated: false,
      messages: [
        { role: "user", content: "Fix auth." },
        { role: "assistant", content: "Implemented rotation." },
      ],
    },
    repository: {
      head: "abc123",
      branch: "main",
      changedFiles: ["src/auth.ts"],
      diffStat: "src/auth.ts | 2 ++",
      diff: "diff --git a/src/auth.ts b/src/auth.ts\n+``` embedded",
      diffTruncated: false,
    },
    metadata: { createdAt: "2026-08-22T12:00:00.000Z" },
    ...overrides,
  };
}

test("renders roles, changed files, and a safe diff fence", () => {
  const markdown = renderHandoffMarkdown(context());
  assert.match(markdown, /### User\n\nFix auth\./);
  assert.match(markdown, /### Cursor\n\nImplemented rotation\./);
  assert.match(markdown, /- src\/auth\.ts/);
  assert.match(markdown, /````diff/);
  assert.match(markdown, /\+``` embedded/);
});

test("renders conversation and diff truncation notices", () => {
  const value = context();
  value.conversation!.truncated = true;
  value.repository.diff = undefined;
  value.repository.diffTruncated = true;
  const markdown = renderHandoffMarkdown(value);
  assert.match(markdown, /Earlier conversation content was omitted/);
  assert.match(markdown, /Full Git diff omitted/);
});

test("renders a useful message when Git is unavailable", () => {
  const markdown = renderHandoffMarkdown(
    context({ repository: { changedFiles: [], diffTruncated: false } }),
  );
  assert.match(markdown, /Git repository not detected/);
});
