import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { HandoffFileStore } from "../src/handoff/handoffFileStore";
import type { HandoffContext } from "../src/handoff/types";

function context(createdAt: string): HandoffContext {
  return {
    source: "codex",
    workspacePath: "C:\\work",
    conversation: {
      messages: [{ role: "assistant", content: createdAt }],
      truncated: false,
    },
    repository: { changedFiles: [], diffTruncated: false },
    metadata: { createdAt },
  };
}

test("keeps the newest handoff files across both directions", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "handoff-store-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new HandoffFileStore(directory, 2);

  for (let second = 0; second < 3; second += 1) {
    const stored = await store.write(
      context(`2026-08-22T13:00:0${second}.000Z`),
    );
    const date = new Date(1_787_403_600_000 + second * 1_000);
    await fs.utimes(stored.filePath, date, date);
  }

  const files = await fs.readdir(path.join(directory, "handoffs"));
  assert.equal(files.length, 2);
  assert.equal(files.some((file) => file.includes("13-00-00")), false);
});
