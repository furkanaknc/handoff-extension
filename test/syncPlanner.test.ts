import assert from "node:assert/strict";
import test from "node:test";
import { buildSourceCheckpoint } from "../src/handoff/sourceCursor";
import {
  fingerprintRepository,
  planHandoff,
} from "../src/handoff/syncPlanner";
import type {
  Conversation,
  DirectionSyncState,
  HandoffMessage,
  RepositorySnapshot,
} from "../src/handoff/types";

const repository: RepositorySnapshot = {
  head: "abc",
  branch: "main",
  changedFiles: [],
  diffHash: "repo-hash",
  diffTruncated: false,
};

const defaults = {
  includeFullDiff: false,
  maxHandoffTokens: 6000,
  maxConversationTokens: 4500,
};

function conversation(messages: HandoffMessage[], id = "source"): Conversation {
  return { id, messages, truncated: false, rawOffset: 1000 };
}

function previous(
  messages: HandoffMessage[],
  overrides: Partial<DirectionSyncState> = {},
): DirectionSyncState {
  return {
    sourceSessionId: "source",
    targetSessionId: "target",
    sourceCheckpoint: buildSourceCheckpoint(messages, 500),
    repositoryFingerprint: fingerprintRepository(repository),
    lastHandoffId: "previous",
    lastHandoffAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

function run(
  messages: HandoffMessage[],
  previousState?: DirectionSyncState,
  overrides: Partial<Parameters<typeof planHandoff>[0]> = {},
) {
  return planHandoff({
    conversation: conversation(messages),
    repository,
    previousState,
    targetSessionId: "target",
    continuityVerified: true,
    handoffId: "next",
    createdAt: "2026-08-22T01:00:00.000Z",
    ...defaults,
    ...overrides,
  });
}

const abc: HandoffMessage[] = [
  { role: "user", content: "A" },
  { role: "assistant", content: "B" },
  { role: "user", content: "C" },
];

test("uses bootstrap mode without safe matching state", () => {
  const missing = run(abc);
  const sourceChanged = run(abc, previous(abc, { sourceSessionId: "other" }));
  const targetChanged = run(abc, previous(abc, { targetSessionId: "other" }));
  const targetUnknown = run(abc, previous(abc), { targetSessionId: undefined });
  for (const result of [missing, sourceChanged, targetChanged, targetUnknown]) {
    assert.equal(result.status, "handoff");
    if (result.status === "handoff") {
      assert.equal(result.plan.mode, "bootstrap");
    }
  }
});

test("uses repository-only mode when only repository state changed", () => {
  const result = run(abc, previous(abc), {
    repository: { ...repository, changedFiles: ["src/new.ts"], diffHash: "changed" },
  });
  assert.equal(result.status, "handoff");
  if (result.status === "handoff") {
    assert.equal(result.plan.mode, "repository-only");
    assert.deepEqual(result.plan.messages, []);
    assert.equal(result.plan.repository?.changedFiles[0], "src/new.ts");
  }
});

test("reports already synchronized when conversation and repository match", () => {
  assert.deepEqual(run(abc, previous(abc)), {
    status: "already-synchronized",
  });
});

test("uses delta when source checkpoint anchors match", () => {
  const state = previous(abc);
  const current = [...abc, { role: "assistant", content: "D" } as const];
  const result = run(current, state);
  assert.equal(result.status, "handoff");
  if (result.status === "handoff") {
    assert.equal(result.plan.mode, "delta");
    assert.deepEqual(result.plan.messages, [{ role: "assistant", content: "D" }]);
    assert.equal(result.plan.repository, undefined);
  }
});

test("uses recovery when legacy state lacks a checkpoint", () => {
  const legacy = previous(abc);
  delete legacy.sourceCheckpoint;
  legacy.transferredMessageCount = abc.length;
  legacy.transferredPrefixHash = "legacy";
  const result = run([...abc, { role: "assistant", content: "D" }], legacy);
  assert.equal(result.status, "handoff");
  if (result.status === "handoff") {
    assert.equal(result.plan.mode, "recovery");
  }
});

test("continues delta after sliding window removes older messages", () => {
  const transferred: HandoffMessage[] = Array.from({ length: 200 }, (_, index) => ({
    role: (index % 2 === 0 ? "user" : "assistant") as HandoffMessage["role"],
    content: `message-${index}`,
  }));
  const state = previous(transferred);
  const current: HandoffMessage[] = [
    ...transferred.slice(1),
    { role: "assistant", content: "message-200" },
  ];
  const result = run(current, state);
  assert.equal(result.status, "handoff");
  if (result.status === "handoff") {
    assert.equal(result.plan.mode, "delta");
    assert.deepEqual(result.plan.messages, [
      { role: "assistant", content: "message-200" },
    ]);
  }
});

test("sends only appended content when the last transferred message grew", () => {
  const state = previous([
    { role: "user", content: "A" },
    { role: "assistant", content: "Partial" },
  ]);
  const current: HandoffMessage[] = [
    { role: "user", content: "A" },
    { role: "assistant", content: "Partial\n\nMore detail" },
  ];
  const result = run(current, state);
  assert.equal(result.status, "handoff");
  if (result.status === "handoff") {
    assert.equal(result.plan.mode, "delta");
    assert.deepEqual(result.plan.messages, [
      { role: "assistant", content: "More detail" },
    ]);
  }
});

test("requires verified continuity before using delta", () => {
  const result = run([...abc, { role: "assistant", content: "D" }], previous(abc), {
    continuityVerified: false,
  });
  assert.equal(result.status === "handoff" && result.plan.mode, "bootstrap");
});

test("never exceeds the configured handoff token budget", () => {
  const huge = [{ role: "assistant" as const, content: "x".repeat(100_000) }];
  const result = run(huge, undefined, {
    maxHandoffTokens: 6000,
    maxConversationTokens: 4500,
  });
  assert.equal(result.status, "handoff");
  if (result.status === "handoff") {
    assert.ok(result.plan.stats.outgoingEstimatedTokens <= 6000);
  }
});
