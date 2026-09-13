import assert from "node:assert/strict";
import test from "node:test";
import { resolveWorkspaceCandidate } from "../src/handoff/workspaceResolution";

test("a single stored binding wins when the active editor changes roots", () => {
  const result = resolveWorkspaceCandidate(
    [
      { path: "C:\\work\\api", hasBinding: true },
      { path: "C:\\work\\frontend", hasBinding: false },
    ],
    "C:\\work\\frontend",
  );
  assert.deepEqual(result, { kind: "selected", index: 0, reason: "binding" });
});

test("uses the active editor only when no root has a binding", () => {
  const result = resolveWorkspaceCandidate(
    [
      { path: "C:\\work\\api", hasBinding: false },
      { path: "C:\\work\\frontend", hasBinding: false },
    ],
    "C:\\work\\frontend",
  );
  assert.deepEqual(result, {
    kind: "selected",
    index: 1,
    reason: "active-editor",
  });
});

test("requires explicit selection when multiple roots are bound", () => {
  assert.deepEqual(
    resolveWorkspaceCandidate([
      { path: "C:\\work\\api", hasBinding: true },
      { path: "C:\\work\\frontend", hasBinding: true },
    ]),
    { kind: "ambiguous" },
  );
});
