import assert from "node:assert/strict";
import test from "node:test";
import { finalizeHandoffWithinBudget } from "../src/handoff/boundedHandoff";
import { renderHandoffMarkdown } from "../src/handoff/renderMarkdown";
import { CharacterTokenEstimator } from "../src/handoff/tokenBudget";
import type { HandoffContext, HandoffMessage } from "../src/handoff/types";

function context(messages: HandoffMessage[]): HandoffContext {
  return {
    source: "cursor",
    workspacePath: "C:\\work",
    conversation: { id: "source", messages, truncated: false },
    repository: { branch: "main", head: "abc", changedFiles: [] },
    metadata: {
      createdAt: "2026-09-13T00:00:00.000Z",
      handoffId: "handoff",
      mode: "bootstrap",
      stats: {
        mode: "bootstrap",
        continuityReason: "test",
        sourceEstimatedTokens: 10_000,
        outgoingEstimatedTokens: 0,
        conversationTokens: 0,
        repositoryTokens: 0,
        metadataTokens: 0,
        messagesIncluded: messages.length,
        messagesOmitted: 0,
      },
    },
  };
}

const estimator = new CharacterTokenEstimator();

test("bounds the actual rendered Markdown for many tiny messages", () => {
  const value = context(
    Array.from({ length: 4_500 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: "x",
    })),
  );
  const bounded = finalizeHandoffWithinBudget(value, 6_000);
  const renderedTokens = estimator.estimate(renderHandoffMarkdown(bounded));
  assert.ok(renderedTokens <= 6_000);
  assert.equal(bounded.metadata.stats?.outgoingEstimatedTokens, renderedTokens);
  assert.equal(bounded.conversation?.truncated, true);
});

test("drops an oversized optional diff before useful conversation", () => {
  const value = context([{ role: "user", content: "Keep this request" }]);
  value.repository = {
    branch: "main",
    head: "abc",
    changedFiles: [],
    diff: "x".repeat(50_000),
  };
  const bounded = finalizeHandoffWithinBudget(value, 6_000);
  assert.equal(bounded.repository?.diff, undefined);
  assert.equal(bounded.repository?.diffOmittedReason, "token-budget");
  assert.equal(bounded.conversation?.messages[0].content, "Keep this request");
  assert.ok(estimator.estimate(renderHandoffMarkdown(bounded)) <= 6_000);
});

test("truncates one huge message to fit the final rendered payload", () => {
  const bounded = finalizeHandoffWithinBudget(
    context([{ role: "assistant", content: "x".repeat(100_000) }]),
    2_000,
  );
  assert.match(bounded.conversation?.messages[0].content ?? "", /^\[Message truncated\]/);
  assert.ok(estimator.estimate(renderHandoffMarkdown(bounded)) <= 2_000);
});

test("turns an oversized delta into bounded recovery instead of skipping new messages", () => {
  const value = context(
    Array.from({ length: 1_000 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: "delta",
    })),
  );
  value.metadata.mode = "delta";
  value.metadata.stats!.mode = "delta";
  const fullHistory: HandoffMessage[] = [
    { role: "user", content: "earlier context" },
    ...value.conversation!.messages,
  ];
  const bounded = finalizeHandoffWithinBudget(value, 500, estimator, {
    messages: fullHistory,
    repository: { branch: "main", head: "abc", changedFiles: [] },
    sourceHistoryTruncated: false,
  });
  assert.equal(bounded.metadata.mode, "recovery");
  assert.equal(bounded.metadata.stats?.mode, "recovery");
  assert.match(
    bounded.metadata.stats?.continuityReason ?? "",
    /Delta exceeded the final payload budget/,
  );
  assert.ok(estimator.estimate(renderHandoffMarkdown(bounded)) <= 500);
});
