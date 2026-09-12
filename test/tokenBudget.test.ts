import assert from "node:assert/strict";
import test from "node:test";
import { buildConversationWithinBudget } from "../src/handoff/tokenBudget";
import type { HandoffMessage } from "../src/handoff/types";

test("preserves complete turns from newest messages backward", () => {
  const messages: HandoffMessage[] = [
    { role: "user", content: "old" },
    { role: "assistant", content: "old reply" },
    { role: "user", content: "recent" },
    { role: "assistant", content: "recent reply" },
  ];
  const result = buildConversationWithinBudget(messages, 5);
  assert.deepEqual(result.messages, [
    { role: "user", content: "recent" },
    { role: "assistant", content: "recent reply" },
  ]);
  assert.equal(result.truncated, true);
});

test("truncates an oversized single message predictably", () => {
  const messages: HandoffMessage[] = [
    { role: "assistant", content: "x".repeat(1000) },
  ];
  const result = buildConversationWithinBudget(messages, 50);
  assert.equal(result.messages.length, 1);
  assert.match(result.messages[0].content, /^\[Message truncated\]/);
});
