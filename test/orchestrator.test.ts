import assert from "node:assert/strict";
import test from "node:test";
import { performCursorToCodexHandoff } from "../src/handoff/orchestrator";
import type {
  CodexTarget,
  CursorConversationSource,
  HandoffContext,
} from "../src/handoff/types";

test("builds structured context and sends it to the target", async () => {
  const source: CursorConversationSource = {
    async getCurrentConversation(workspacePath) {
      assert.equal(workspacePath, "C:\\work\\sample");
      return {
        id: "conversation-id",
        truncated: false,
        messages: [{ role: "user", content: "Continue." }],
      };
    },
  };
  let received: HandoffContext | undefined;
  const target: CodexTarget = {
    async sendHandoff(context) {
      received = context;
    },
  };

  const result = await performCursorToCodexHandoff(
    "C:\\work\\sample",
    source,
    target,
    async () => ({
      branch: "main",
      changedFiles: ["src/file.ts"],
      diffTruncated: false,
    }),
    () => new Date("2026-08-22T12:00:00.000Z"),
  );

  assert.equal(result.source, "cursor");
  assert.equal(result.metadata.createdAt, "2026-08-22T12:00:00.000Z");
  assert.deepEqual(received, result);
});

test("does not call the target when conversation capture fails", async () => {
  let called = false;
  await assert.rejects(
    performCursorToCodexHandoff(
      "workspace",
      {
        async getCurrentConversation() {
          throw new Error("capture failed");
        },
      },
      {
        async sendHandoff() {
          called = true;
        },
      },
      async () => ({ changedFiles: [], diffTruncated: false }),
    ),
    /capture failed/,
  );
  assert.equal(called, false);
});
