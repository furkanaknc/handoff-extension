import assert from "node:assert/strict";
import test from "node:test";
import {
  fingerprintRepository,
  hashMessages,
  planHandoff,
} from "../src/handoff/syncPlanner";
import type {
  Conversation,
  DirectionSyncState,
  GitContext,
  HandoffMessage,
} from "../src/handoff/types";

const repository: GitContext = {
  head: "abc",
  branch: "main",
  changedFiles: [],
  diffTruncated: false,
};

function conversation(messages: HandoffMessage[], id = "source"): Conversation {
  return { id, messages, truncated: false };
}

function previous(
  messages: HandoffMessage[],
  overrides: Partial<DirectionSyncState> = {},
): DirectionSyncState {
  return {
    sourceSessionId: "source",
    targetSessionId: "target",
    transferredMessageCount: messages.length,
    transferredPrefixHash: hashMessages(messages),
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
    ...overrides,
  });
}

const abc: HandoffMessage[] = [
  { role: "user", content: "A" },
  { role: "assistant", content: "B" },
  { role: "user", content: "C" },
];

test("uses full mode without safe matching state", () => {
  const missing = run(abc);
  const sourceChanged = run(abc, previous(abc, { sourceSessionId: "other" }));
  const targetChanged = run(abc, previous(abc, { targetSessionId: "other" }));
  const targetUnknown = run(abc, previous(abc), { targetSessionId: undefined });
  for (const result of [missing, sourceChanged, targetChanged, targetUnknown]) {
    assert.equal(result.status, "handoff");
    if (result.status === "handoff") {
      assert.equal(result.plan.mode, "full");
    }
  }
});

test("uses repository-only mode when only repository state changed", () => {
  const result = run(abc, previous(abc), {
    repository: { ...repository, changedFiles: ["src/new.ts"] },
  });
  assert.equal(result.status, "handoff");
  if (result.status === "handoff") {
    assert.equal(result.plan.mode, "repository-only");
    assert.deepEqual(result.plan.messages, []);
  }
});

test("reports already synchronized when conversation and repository match", () => {
  assert.deepEqual(run(abc, previous(abc)), {
    status: "already-synchronized",
  });
});

test("uses delta only when the transferred prefix matches", () => {
  const state = previous(abc, { repositoryFingerprint: "different" });
  const current = [...abc, { role: "assistant", content: "D" } as const];
  const result = run(current, state);
  assert.equal(result.status, "handoff");
  if (result.status === "handoff") {
    assert.equal(result.plan.mode, "delta");
    assert.deepEqual(result.plan.messages, [{ role: "assistant", content: "D" }]);
  }
});

test("falls back to full for shorter or mutated history", () => {
  const state = previous(abc);
  const shorter = run(abc.slice(0, 2), state);
  const mutated = run(
    [abc[0], { role: "assistant", content: "X" }, abc[2]],
    state,
  );
  assert.equal(shorter.status === "handoff" && shorter.plan.mode, "full");
  assert.equal(mutated.status === "handoff" && mutated.plan.mode, "full");
});

test("requires verified continuity before using delta", () => {
  const result = run([...abc, { role: "assistant", content: "D" }], previous(abc), {
    continuityVerified: false,
  });
  assert.equal(result.status === "handoff" && result.plan.mode, "full");
});
