import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { FileSyncStateStore } from "../src/handoff/syncStateStore";

const state = {
  sourceSessionId: "source",
  targetSessionId: "target",
  transferredMessageCount: 2,
  transferredPrefixHash: "hash",
  repositoryFingerprint: "repository",
  lastHandoffId: "handoff",
  lastHandoffAt: "2026-08-22T00:00:00.000Z",
};

test("atomically stores workspace-scoped directional state", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "handoff-memory-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new FileSyncStateStore(directory);
  await store.saveDirection("C:\\work\\one", "codexToCursor", state);
  assert.deepEqual((await store.load("C:\\work\\one")).codexToCursor, state);
  assert.deepEqual(await store.load("C:\\work\\two"), { version: 1 });
});

test("corrupt state safely falls back to empty memory and reset removes it", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "handoff-memory-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  let warnings = 0;
  const store = new FileSyncStateStore(directory, () => warnings++);
  await fs.mkdir(path.dirname(store.pathForTesting("workspace")), { recursive: true });
  await fs.writeFile(store.pathForTesting("workspace"), "{broken", "utf8");
  assert.deepEqual(await store.load("workspace"), { version: 1 });
  assert.equal(warnings, 1);
  await store.reset("workspace");
  assert.equal(await fs.stat(store.pathForTesting("workspace")).then(() => true, () => false), false);
});
