import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getGitContext } from "../src/handoff/gitContext";

function git(cwd: string, ...args: string[]): void {
  execFileSync("git", args, { cwd, stdio: "ignore", windowsHide: true });
}

async function createRepository(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "handoff-git-"));
  git(directory, "init", "-b", "main");
  git(directory, "config", "user.email", "test@example.invalid");
  git(directory, "config", "user.name", "Handoff Test");
  await fs.writeFile(path.join(directory, "tracked.txt"), "first\n", "utf8");
  git(directory, "add", "tracked.txt");
  git(directory, "commit", "-m", "initial");
  return directory;
}

test("captures branch, changed files, stat, and diff hash without full diff by default", async (t) => {
  const directory = await createRepository();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "tracked.txt"), "first\nsecond\n", "utf8");
  await fs.writeFile(path.join(directory, "untracked.txt"), "new\n", "utf8");

  const context = await getGitContext(directory, 100_000, false);
  assert.ok(context.head);
  assert.ok(context.branch);
  assert.deepEqual(context.changedFiles.sort(), ["tracked.txt", "untracked.txt"]);
  assert.match(context.diffStat ?? "", /tracked\.txt/);
  assert.ok(context.diffHash);
  assert.equal(context.diff, undefined);
  assert.equal(context.diffTruncated, false);
});

test("includes full diff only when requested", async (t) => {
  const directory = await createRepository();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "tracked.txt"), "first\nsecond\n", "utf8");

  const context = await getGitContext(directory, 100_000, true);
  assert.match(context.diff ?? "", /\+second/);
});

test("omits an oversized diff while preserving stat and changed files", async (t) => {
  const directory = await createRepository();
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, "tracked.txt"), "x".repeat(50_000), "utf8");

  const context = await getGitContext(directory, 64, true);
  assert.equal(context.diff, undefined);
  assert.equal(context.diffTruncated, true);
  assert.deepEqual(context.changedFiles, ["tracked.txt"]);
  assert.ok(context.diffStat);
  assert.ok(context.diffHash);
});

test("returns optional empty context outside a Git repository", async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "handoff-no-git-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  assert.deepEqual(await getGitContext(directory, 100), {
    changedFiles: [],
    diffTruncated: false,
  });
});
