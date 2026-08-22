import assert from "node:assert/strict";
import test from "node:test";
import {
  performCodexToCursorHandoff,
  performCursorToCodexHandoff,
  performSynchronizedHandoff,
} from "../src/handoff/orchestrator";
import type {
  CodexTarget,
  CursorConversationSource,
  HandoffContext,
  WorkspaceMemory,
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

test("builds Codex context and sends it to the Cursor target", async () => {
  let received: HandoffContext | undefined;
  const result = await performCodexToCursorHandoff(
    "C:\\work\\sample",
    {
      async getCurrentConversation() {
        return {
          id: "codex-thread",
          truncated: false,
          messages: [{ role: "assistant", content: "Codex result." }],
        };
      },
    },
    {
      async sendHandoff(context) {
        received = context;
      },
    },
    async () => ({ changedFiles: [], diffTruncated: false }),
    () => new Date("2026-08-22T13:00:00.000Z"),
  );
  assert.equal(result.source, "codex");
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

function memoryStore(initial: WorkspaceMemory = { version: 1 }) {
  let memory = initial;
  let saves = 0;
  return {
    async load() {
      return memory;
    },
    async saveDirection(_workspace: string, direction: "cursorToCodex" | "codexToCursor", state: any) {
      saves++;
      memory = { ...memory, [direction]: state };
    },
    get memory() {
      return memory;
    },
    get saves() {
      return saves;
    },
  };
}

test("advances sync state only after a successful target transfer", async () => {
  const store = memoryStore();
  const source = {
    async getCurrentConversation() {
      return {
        id: "thread",
        truncated: false,
        messages: [{ role: "user" as const, content: "A" }],
      };
    },
  };
  const base = {
    workspacePath: "workspace",
    direction: "codexToCursor" as const,
    sourceKind: "codex" as const,
    source,
    getRepositoryContext: async () => ({ changedFiles: [], diffTruncated: false }),
    syncStateStore: store,
    getTargetSessionId: async () => "composer",
    now: () => new Date("2026-08-22T13:00:00.000Z"),
    createHandoffId: () => "handoff",
  };

  await assert.rejects(
    performSynchronizedHandoff({
      ...base,
      target: { async sendHandoff() { throw new Error("attach failed"); } },
    }),
    /attach failed/,
  );
  assert.equal(store.saves, 0);

  const result = await performSynchronizedHandoff({
    ...base,
    target: { async sendHandoff() { return true; } },
  });
  assert.equal(result.status, "transferred");
  assert.equal(store.saves, 1);
  assert.equal(store.memory.codexToCursor?.transferredMessageCount, 1);
});

test("skips target invocation when source and repository are synchronized", async () => {
  const firstStore = memoryStore();
  const source = {
    async getCurrentConversation() {
      return {
        id: "thread",
        truncated: false,
        messages: [{ role: "user" as const, content: "A" }],
      };
    },
  };
  let calls = 0;
  const options = {
    workspacePath: "workspace",
    direction: "codexToCursor" as const,
    sourceKind: "codex" as const,
    source,
    target: { async sendHandoff() { calls++; return true; } },
    getRepositoryContext: async () => ({ changedFiles: [], diffTruncated: false }),
    syncStateStore: firstStore,
    getTargetSessionId: async () => "composer",
    now: () => new Date("2026-08-22T13:00:00.000Z"),
    createHandoffId: () => "handoff",
  };
  await performSynchronizedHandoff(options);
  const result = await performSynchronizedHandoff(options);
  assert.equal(result.status, "already-synchronized");
  assert.equal(calls, 1);
});

test("manual fallback does not advance sync state", async () => {
  const store = memoryStore();
  const result = await performSynchronizedHandoff({
    workspacePath: "workspace",
    direction: "codexToCursor",
    sourceKind: "codex",
    source: {
      async getCurrentConversation() {
        return { id: "thread", truncated: false, messages: [] };
      },
    },
    target: { async sendHandoff() { return false; } },
    getRepositoryContext: async () => ({ changedFiles: [], diffTruncated: false }),
    syncStateStore: store,
    getTargetSessionId: async () => "composer",
  });
  assert.equal(result.status, "manual-transfer");
  assert.equal(store.saves, 0);
});
