import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  applyConversationLimits,
  parseCursorTranscript,
} from "../src/cursor/transcriptParser";

const fixtures = path.resolve(__dirname, "../../test/fixtures");
const limits = { maxMessages: 200, maxCharacters: 200_000 };

test("parses normal user and assistant messages in order", async () => {
  const conversation = await parseCursorTranscript(
    path.join(fixtures, "normal.jsonl"),
    "conversation-1",
    limits,
  );
  assert.equal(conversation.id, "conversation-1");
  assert.equal(conversation.truncated, false);
  assert.deepEqual(
    conversation.messages.map(({ role, content }) => [role, content]),
    [
      ["user", "Fix the scheduler race."],
      ["assistant", "I found the race in worker replacement."],
      ["user", "Implement it and add tests."],
      ["assistant", "Implemented the lock and regression test."],
    ],
  );
});

test("ignores tool use and thinking while preserving visible assistant text", async () => {
  const conversation = await parseCursorTranscript(
    path.join(fixtures, "tool-heavy.jsonl"),
    undefined,
    limits,
  );
  assert.deepEqual(conversation.messages, [
    { role: "user", content: "Inspect auth." },
    {
      role: "assistant",
      content:
        "I will inspect the service.\n\nToken rotation needs an atomic update.",
    },
  ]);
});

test("ignores unknown events and content item types", async () => {
  const conversation = await parseCursorTranscript(
    path.join(fixtures, "unknown-events.jsonl"),
    undefined,
    limits,
  );
  assert.deepEqual(conversation.messages, [
    { role: "user", content: "Keep this." },
    { role: "assistant", content: "Keep this too." },
  ]);
});

test("skips a malformed final JSONL event", async () => {
  const conversation = await parseCursorTranscript(
    path.join(fixtures, "malformed-final.jsonl"),
    undefined,
    limits,
  );
  assert.equal(conversation.messages.length, 2);
});

test("returns an empty conversation for an empty transcript", async () => {
  const conversation = await parseCursorTranscript(
    path.join(fixtures, "empty.jsonl"),
    undefined,
    limits,
  );
  assert.deepEqual(conversation.messages, []);
});

test("keeps the newest messages and character tail when limits are exceeded", () => {
  const limited = applyConversationLimits(
    [
      { role: "user", content: "old" },
      { role: "assistant", content: "middle" },
      { role: "user", content: "1234567890" },
    ],
    { maxMessages: 2, maxCharacters: 5 },
  );
  assert.equal(limited.truncated, true);
  assert.deepEqual(limited.messages, [{ role: "user", content: "67890" }]);
});
