import assert from "node:assert/strict";
import test from "node:test";
import {
  codexThreadHasActiveTurn,
  parseCodexThread,
} from "../src/codex/conversationParser";

test("parses visible Codex messages and ignores internal items", () => {
  const conversation = parseCodexThread(
    {
      id: "thread-id",
      turns: [
        {
          status: "completed",
          items: [
            { type: "userMessage", content: [{ type: "text", text: "Fix it." }] },
            { type: "reasoning", content: "private" },
            { type: "agentMessage", phase: "commentary", text: "Inspecting." },
            { type: "commandExecution", aggregatedOutput: "secret output" },
            { type: "agentMessage", phase: "final_answer", text: "Fixed." },
            { type: "plan", text: "1. Verify." },
          ],
        },
      ],
    },
    { maxMessages: 200, maxCharacters: 200_000 },
  );

  assert.equal(conversation.id, "thread-id");
  assert.deepEqual(conversation.messages, [
    { role: "user", content: "Fix it." },
    { role: "assistant", content: "Inspecting.\n\nFixed.\n\n1. Verify." },
  ]);
  assert.doesNotMatch(JSON.stringify(conversation), /private|secret output/);
});

test("uses a placeholder for image-only user messages", () => {
  const conversation = parseCodexThread(
    {
      turns: [
        {
          status: "completed",
          items: [
            { type: "userMessage", content: [{ type: "image", url: "data:image/png" }] },
            { type: "agentMessage", phase: "final_answer", text: "I inspected it." },
          ],
        },
      ],
    },
    { maxMessages: 200, maxCharacters: 200_000 },
  );
  assert.match(conversation.messages[0].content, /attached an image/);
});

test("detects active turns and applies conversation limits", () => {
  const thread = {
    turns: [
      {
        status: "inProgress",
        items: [
          { type: "userMessage", content: [{ type: "text", text: "123456" }] },
          { type: "agentMessage", phase: "commentary", text: "abcdef" },
        ],
      },
    ],
  };
  assert.equal(codexThreadHasActiveTurn(thread), true);
  const conversation = parseCodexThread(thread, {
    maxMessages: 1,
    maxCharacters: 3,
  });
  assert.equal(conversation.truncated, true);
  assert.deepEqual(conversation.messages, [
    { role: "assistant", content: "def" },
  ]);
});

test("does not recursively export generated handoff transport text", () => {
  const generated = "<!-- cursor-codex-handoff\nversion: 1\nhandoff-id: old\n-->\n# Handoff";
  const conversation = parseCodexThread(
    {
      turns: [{
        items: [
          { type: "userMessage", content: [{ type: "text", text: generated }] },
          { type: "userMessage", content: [{ type: "text", text: "Continue with the real task." }] },
        ],
      }],
    },
    { maxMessages: 200, maxCharacters: 200_000 },
  );
  assert.deepEqual(conversation.messages, [
    { role: "user", content: "Continue with the real task." },
  ]);
});
