import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSourceCheckpoint,
  extractDeltaMessages,
  locateDelta,
} from "../src/handoff/sourceCursor";
import type { HandoffMessage } from "../src/handoff/types";

test("locates delta after sliding window shift", () => {
  const transferred: HandoffMessage[] = Array.from({ length: 200 }, (_, index) => ({
    role: (index % 2 === 0 ? "user" : "assistant") as HandoffMessage["role"],
    content: `message-${index}`,
  }));
  const checkpoint = buildSourceCheckpoint(transferred)!;
  const current: HandoffMessage[] = [
    ...transferred.slice(1),
    { role: "assistant", content: "message-200" },
  ];
  const location = locateDelta(current, checkpoint);
  assert.equal(location.kind, "delta");
  if (location.kind === "delta") {
    assert.deepEqual(extractDeltaMessages(current, location), [
      { role: "assistant", content: "message-200" },
    ]);
  }
});

test("returns recovery when anchors cannot be found", () => {
  const checkpoint = buildSourceCheckpoint([
    { role: "user", content: "old" },
  ])!;
  assert.deepEqual(locateDelta([{ role: "user", content: "new" }], checkpoint), {
    kind: "recovery",
  });
});
