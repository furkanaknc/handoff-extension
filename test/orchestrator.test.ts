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
  HandoffMessage,
  WorkspaceMemory,
} from "../src/handoff/types";

const runtime = {
  includeFullDiff: false,
  maxHandoffTokens: 6000,
  maxConversationTokens: 4500,
};

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

function memoryStore(initial: WorkspaceMemory = { version: 3 }) {
  let memory = initial;
  let saves = 0;
  return {
    async load() {
      return memory;
    },
    async commitSuccessfulTransfer(
      _workspace: string,
      direction: "cursorToCodex" | "codexToCursor",
      state: any,
      sessionBinding?: any,
      manifest?: any,
    ) {
      saves++;
      memory = {
        ...memory,
        [direction]: state,
        ...(sessionBinding ? { sessionBinding } : {}),
        ...(manifest
          ? { recentManifests: [manifest, ...(memory.recentManifests ?? [])] }
          : {}),
      };
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
    runtime,
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
  assert.ok(store.memory.codexToCursor?.sourceCheckpoint);
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
    runtime,
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
    runtime,
    getTargetSessionId: async () => "composer",
  });
  assert.equal(result.status, "manual-transfer");
  assert.equal(store.saves, 0);
});

test("creates a binding after bootstrap and uses delta only for the verified same pair", async () => {
  const store = memoryStore();
  let messages: HandoffMessage[] = [{ role: "user", content: "A" }];
  const modes: Array<string | undefined> = [];
  const options = {
    workspacePath: "workspace",
    direction: "cursorToCodex" as const,
    sourceKind: "cursor" as const,
    source: {
      async getCurrentConversation() {
        return { id: "C1", truncated: false, messages };
      },
    },
    target: {
      async sendHandoff(context: HandoffContext) {
        modes.push(context.metadata.mode);
        return true;
      },
    },
    getRepositoryContext: async () => ({ changedFiles: [], diffTruncated: false }),
    syncStateStore: store,
    runtime,
    resolveTargetSession: async () => ({
      id: "X1",
      label: "Thread X1",
      verificationMethod: "explicit-selection" as const,
    }),
    now: () => new Date("2026-08-22T14:00:00.000Z"),
  };

  await performSynchronizedHandoff(options);
  assert.equal(store.memory.sessionBinding?.cursorConversationId, "C1");
  assert.equal(store.memory.sessionBinding?.codexThreadId, "X1");
  messages = [...messages, { role: "assistant", content: "B" }];
  await performSynchronizedHandoff(options);
  assert.deepEqual(modes, ["bootstrap", "delta"]);
});

test("preview mode does not call the target or advance sync state", async () => {
  const store = memoryStore();
  let called = false;
  const result = await performSynchronizedHandoff({
    workspacePath: "workspace",
    direction: "codexToCursor",
    sourceKind: "codex",
    source: {
      async getCurrentConversation() {
        return {
          id: "thread",
          truncated: false,
          messages: [{ role: "user", content: "A" }],
        };
      },
    },
    target: {
      async sendHandoff() {
        called = true;
        return true;
      },
    },
    getRepositoryContext: async () => ({ changedFiles: [], diffTruncated: false }),
    syncStateStore: store,
    runtime,
    dryRun: true,
    getTargetSessionId: async () => "composer",
  });
  assert.equal(result.status, "preview");
  assert.equal(called, false);
  assert.equal(store.saves, 0);
});

test("does not persist a new binding when Cursor to Codex attachment fails", async () => {
  const store = memoryStore();
  await assert.rejects(
    performSynchronizedHandoff({
      workspacePath: "workspace",
      direction: "cursorToCodex",
      sourceKind: "cursor",
      source: {
        async getCurrentConversation() {
          return {
            id: "C1",
            truncated: false,
            messages: [{ role: "user", content: "A" }],
          };
        },
      },
      target: { async sendHandoff() { throw new Error("attach failed"); } },
      getRepositoryContext: async () => ({ changedFiles: [], diffTruncated: false }),
      syncStateStore: store,
      runtime,
      resolveTargetSession: async () => ({
        id: "X1",
        label: "Thread X1",
        verificationMethod: "explicit-selection",
      }),
    }),
    /attach failed/,
  );
  assert.equal(store.saves, 0);
  assert.equal(store.memory.sessionBinding, undefined);
});
