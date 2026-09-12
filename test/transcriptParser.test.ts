import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
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
  assert.ok((conversation.rawOffset ?? 0) > 0);
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

test("does not recursively export generated handoff transport text", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "handoff-transcript-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const transcriptPath = path.join(directory, "transcript.jsonl");
  const generated = "<!-- cursor-codex-handoff\nversion: 1\nhandoff-id: old\n-->\n# Handoff";
  const lines = [
    { role: "user", message: { content: [{ type: "text", text: generated }] } },
    { role: "user", message: { content: [{ type: "text", text: "Keep this follow-up." }] } },
  ];
  await fs.writeFile(transcriptPath, lines.map((line) => JSON.stringify(line)).join("\n"));
  const conversation = await parseCursorTranscript(transcriptPath, "id", limits);
  assert.deepEqual(conversation.messages, [
    { role: "user", content: "Keep this follow-up." },
  ]);
});

test("strips coalesced REDACTED placeholders from assistant turns", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "handoff-transcript-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const transcriptPath = path.join(directory, "transcript.jsonl");
  const lines = [
    {
      role: "assistant",
      message: {
        content: [
          {
            type: "text",
            text: "Updating test fixtures.\n\n[REDACTED]",
          },
          { type: "tool_use", name: "Grep", input: { pattern: "foo" } },
        ],
      },
    },
    {
      role: "assistant",
      message: {
        content: [{ type: "text", text: "[REDACTED]" }, { type: "tool_use", name: "Shell", input: {} }],
      },
    },
    {
      role: "assistant",
      message: {
        content: [{ type: "text", text: "[REDACTED]" }, { type: "tool_use", name: "Shell", input: {} }],
      },
    },
    {
      role: "assistant",
      message: {
        content: [{ type: "text", text: "Updated the fixtures and tests pass.\n\n[REDACTED]" }],
      },
    },
  ];
  await fs.writeFile(transcriptPath, lines.map((line) => JSON.stringify(line)).join("\n"));
  const conversation = await parseCursorTranscript(transcriptPath, "id", limits);
  assert.deepEqual(conversation.messages, [
    { role: "assistant", content: "Updated the fixtures and tests pass." },
  ]);
});

test("strips Cursor transport noise and tool preambles from assistant text", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "handoff-transcript-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const transcriptPath = path.join(directory, "transcript.jsonl");
  const lines = [
    {
      role: "assistant",
      message: {
        content: [
          {
            type: "text",
            text: "Checking hook installation and pointer files on the user's machine.\n\n[REDACTED]",
          },
          { type: "tool_use", name: "Shell", input: { command: "ls" } },
        ],
      },
    },
    {
      role: "assistant",
      message: {
        content: [
          {
            type: "text",
            text: "This error is related to hook installation or conversation capture; inspecting the source and flow.\n\n[REDACTED]",
          },
          { type: "tool_use", name: "Grep", input: { pattern: "hook" } },
        ],
      },
    },
    {
      role: "assistant",
      message: {
        content: [{ type: "text", text: "You did not make a mistake — this is an expected message." }],
      },
    },
  ];
  await fs.writeFile(transcriptPath, lines.map((line) => JSON.stringify(line)).join("\n"));
  const conversation = await parseCursorTranscript(transcriptPath, "id", limits);
  assert.deepEqual(conversation.messages, [
    {
      role: "assistant",
      content: "You did not make a mistake — this is an expected message.",
    },
  ]);
});

test("keeps user-facing markdown but drops long tool preambles", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "handoff-transcript-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const transcriptPath = path.join(directory, "transcript.jsonl");
  const lines = [
    {
      role: "assistant",
      message: {
        content: [
          {
            type: "text",
            text: "The handoff still includes REDACTED placeholders and git diff stat; inspecting the source files and filter flow to fix both issues.\n\n[REDACTED]",
          },
          { type: "tool_use", name: "Read", input: { path: "src/handoff/provenance.ts" } },
        ],
      },
    },
    {
      role: "assistant",
      message: {
        content: [
          {
            type: "text",
            text: "Fixed both issues.\n\n**Summary:**\n- REDACTED cleanup is broader now\n- Repository export stays minimal\n\n[REDACTED]",
          },
          { type: "tool_use", name: "Shell", input: { command: "npm test" } },
        ],
      },
    },
  ];
  await fs.writeFile(transcriptPath, lines.map((line) => JSON.stringify(line)).join("\n"));
  const conversation = await parseCursorTranscript(transcriptPath, "id", limits);
  assert.deepEqual(conversation.messages, [
    {
      role: "assistant",
      content:
        "Fixed both issues.\n\n**Summary:**\n- REDACTED cleanup is broader now\n- Repository export stays minimal",
    },
  ]);
});

test("strips generated handoff file references from Cursor transcript text", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "handoff-transcript-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const transcriptPath = path.join(directory, "transcript.jsonl");
  const attachment = [
    "# Files mentioned by the user:",
    "",
    "## handoff-2026-08-22T17-58-16-453Z-id.md: C:\\Users\\user\\AppData\\Roaming\\Cursor\\User\\globalStorage\\handoff-ext.cursor-codex-handoff\\handoffs\\handoff-2026-08-22T17-58-16-453Z-id.md",
    "",
    "## My request for Cursor:",
    "Continue the actual task.",
  ].join("\n");
  await fs.writeFile(
    transcriptPath,
    JSON.stringify({
      role: "user",
      message: { content: [{ type: "text", text: attachment }] },
    }),
  );
  const conversation = await parseCursorTranscript(transcriptPath, "id", limits);
  assert.deepEqual(conversation.messages, [
    { role: "user", content: "## My request for Cursor:\nContinue the actual task." },
  ]);
  assert.doesNotMatch(JSON.stringify(conversation), /handoff-2026|globalStorage/);
});
