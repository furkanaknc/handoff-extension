import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HookCursorConversationSource } from "../src/cursor/conversationSource";
import { pointerFileName } from "../src/cursor/pointer";
import { HandoffError } from "../src/handoff/errors";

test("discovers and parses the transcript selected for a workspace", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "handoff-source-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const workspace = path.join(directory, "workspace");
  const transcript = path.join(directory, "transcript.jsonl");
  await fs.writeFile(
    transcript,
    '{"role":"user","message":{"content":[{"type":"text","text":"Continue."}]}}\n',
    "utf8",
  );
  await fs.writeFile(
    path.join(directory, pointerFileName(workspace)),
    JSON.stringify({
      version: 1,
      conversationId: "conversation-id",
      transcriptPath: transcript,
      workspaceRoot: workspace,
      updatedAt: "2026-08-22T12:00:00.000Z",
    }),
    "utf8",
  );

  const source = new HookCursorConversationSource(directory, {
    maxMessages: 200,
    maxCharacters: 200_000,
  });
  const conversation = await source.getCurrentConversation(workspace);
  assert.equal(conversation.id, "conversation-id");
  assert.deepEqual(conversation.messages, [
    { role: "user", content: "Continue." },
  ]);
});

test("reports a recoverable error when no hook pointer exists", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "handoff-source-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const source = new HookCursorConversationSource(directory, {
    maxMessages: 200,
    maxCharacters: 200_000,
  });
  await assert.rejects(
    source.getCurrentConversation(path.join(directory, "workspace")),
    (error: unknown) =>
      error instanceof HandoffError && error.code === "HOOK_NOT_READY",
  );
});
