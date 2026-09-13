import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  addCursorEnvironmentFallback,
  parseHookInput,
  writeConversationPointers,
} from "../src/cursor/cursorHook";
import {
  hasCurrentHandoffHooks,
  HOOK_MARKER,
  mergeHandoffHooks,
  removeHandoffHooks,
} from "../src/cursor/hookConfig";
import { pointerFileName } from "../src/cursor/pointer";
import { normalizeWorkspacePath } from "../src/cursor/pointer";

test("merges handoff hooks without removing existing configuration", () => {
  const command = `node hook.js ${HOOK_MARKER}`;
  const merged = mergeHandoffHooks(
    {
      version: 1,
      custom: true,
      hooks: {
        beforeSubmitPrompt: [{ command: "existing.exe" }],
        afterFileEdit: [{ command: "formatter.exe" }],
      },
    },
    command,
  );
  assert.equal(merged.custom, true);
  assert.equal(hasCurrentHandoffHooks(merged, command), true);
  const hooks = merged.hooks as Record<string, Array<{ command: string }>>;
  assert.deepEqual(
    hooks.beforeSubmitPrompt.map(({ command: value }) => value),
    ["existing.exe", command],
  );
  assert.equal(hooks.afterFileEdit[0].command, "formatter.exe");
});

test("replaces stale handoff entries instead of duplicating them", () => {
  const command = `node new.js ${HOOK_MARKER}`;
  const merged = mergeHandoffHooks(
    {
      version: 1,
      hooks: {
        beforeSubmitPrompt: [{ command: `node old.js ${HOOK_MARKER}` }],
        afterAgentResponse: [{ command: `node old.js ${HOOK_MARKER}` }],
      },
    },
    command,
  );
  const hooks = merged.hooks as Record<string, Array<{ command: string }>>;
  assert.deepEqual(hooks.beforeSubmitPrompt, [{ command, timeout: 5 }]);
  assert.deepEqual(hooks.afterAgentResponse, [{ command, timeout: 5 }]);
});

test("removes only owned handoff hook entries", () => {
  const cleaned = removeHandoffHooks({
    version: 1,
    hooks: {
      beforeSubmitPrompt: [
        { command: "existing.exe" },
        { command: `node hook.js ${HOOK_MARKER}` },
      ],
      afterAgentResponse: [{ command: `node hook.js ${HOOK_MARKER}` }],
      afterFileEdit: [{ command: "formatter.exe" }],
    },
  });
  assert.deepEqual(cleaned.hooks, {
    beforeSubmitPrompt: [{ command: "existing.exe" }],
    afterFileEdit: [{ command: "formatter.exe" }],
  });
});

test("hook writes a workspace-specific pointer without transcript content", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "handoff-hook-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const workspaceRoot = path.join(directory, "workspace");
  const transcriptPath = path.join(directory, "conversation.jsonl");
  const input = parseHookInput(
    JSON.stringify({
      conversation_id: "conversation-id",
      transcript_path: transcriptPath,
      workspace_roots: [workspaceRoot],
      hook_event_name: "afterAgentResponse",
      prompt: "must not be persisted",
    }),
  );
  assert.ok(input);
  assert.equal(
    await writeConversationPointers(
      input,
      directory,
      () => new Date("2026-08-22T12:00:00.000Z"),
    ),
    1,
  );
  const pointer = await fs.readFile(
    path.join(directory, pointerFileName(workspaceRoot)),
    "utf8",
  );
  assert.match(pointer, /conversation-id/);
  assert.doesNotMatch(pointer, /must not be persisted/);

  assert.equal(
    await writeConversationPointers(
      {
        ...input,
        conversation_id: "new-conversation-id",
      },
      directory,
      () => new Date("2026-08-22T12:01:00.000Z"),
    ),
    1,
  );
  const updatedPointer = await fs.readFile(
    path.join(directory, pointerFileName(workspaceRoot)),
    "utf8",
  );
  assert.match(updatedPointer, /new-conversation-id/);
});

test("hook ignores malformed or incomplete input", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "handoff-hook-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  assert.equal(parseHookInput("{"), undefined);
  assert.equal(
    await writeConversationPointers(
      { conversation_id: "id", transcript_path: null, workspace_roots: [] },
      directory,
    ),
    0,
  );
});

test("hook recovers metadata from Cursor environment when stdin is empty", () => {
  const transcriptPath = path.join(
    "C:\\Users\\test\\.cursor\\projects\\project\\agent-transcripts",
    "conversation-id",
    "conversation-id.jsonl",
  );
  assert.deepEqual(
    addCursorEnvironmentFallback(undefined, {
      CURSOR_TRANSCRIPT_PATH: transcriptPath,
      CURSOR_PROJECT_DIR: "C:\\Work\\handoff-ext",
    }),
    {
      conversation_id: "conversation-id",
      transcript_path: transcriptPath,
      workspace_roots: ["C:\\Work\\handoff-ext"],
    },
  );
});

test("hook parses UTF-16LE input", () => {
  const input = parseHookInput(
    Buffer.from(JSON.stringify({ conversation_id: "utf16-id" }), "utf16le"),
  );
  assert.equal(input?.conversation_id, "utf16-id");
});

test("normalizes Cursor's slash-prefixed Windows drive paths", () => {
  const canonical = "c:/work/handoff-ext";
  assert.equal(normalizeWorkspacePath("/C:/Work/handoff-ext"), canonical);
  assert.equal(normalizeWorkspacePath("C:\\Work\\handoff-ext"), canonical);
  assert.equal(normalizeWorkspacePath("c:\\Work\\handoff-ext"), canonical);
  if (process.platform === "win32") {
    assert.equal(
      pointerFileName("/C:/Work/handoff-ext"),
      pointerFileName("C:\\Work\\handoff-ext"),
    );
  }
});
