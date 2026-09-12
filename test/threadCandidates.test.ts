import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { matchingCodexThreads } from "../src/codex/threadCandidates";

test("filters Codex threads by vscode source and workspace", () => {
  const matches = matchingCodexThreads(
    [
      { id: "current", source: "vscode", cwd: "c:\\Work\\handoff-ext" },
      { id: "cli", source: "cli", cwd: "C:\\Work\\handoff-ext" },
      { id: "other", source: "vscode", cwd: "C:\\Work\\other" },
      { source: "vscode", cwd: "C:\\Work\\handoff-ext" },
    ],
    "C:\\Work\\handoff-ext",
  );
  assert.deepEqual(matches.map(({ id }) => id), ["current"]);
});

test("returns zero, one, or multiple valid candidates deterministically", () => {
  const workspace = path.resolve("/work/sample");
  assert.equal(matchingCodexThreads(undefined, workspace).length, 0);
  assert.equal(
    matchingCodexThreads([{ id: "one" }], workspace).length,
    1,
  );
  assert.deepEqual(
    matchingCodexThreads([{ id: "first" }, { id: "second" }], workspace).map(
      ({ id }) => id,
    ),
    ["first", "second"],
  );
});
