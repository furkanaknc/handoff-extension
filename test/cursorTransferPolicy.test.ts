import assert from "node:assert/strict";
import test from "node:test";
import {
  ADD_FILES_COMMAND,
  cursorTransferPolicy,
  OPEN_CURSOR_CHAT_COMMAND,
  OPEN_GENERIC_CHAT_COMMAND,
} from "../src/cursor/transferPolicy";

test("uses native Cursor attachment and chat commands when registered", () => {
  assert.deepEqual(
    cursorTransferPolicy([ADD_FILES_COMMAND, OPEN_CURSOR_CHAT_COMMAND]),
    { canAttach: true, openChatCommand: OPEN_CURSOR_CHAT_COMMAND },
  );
});

test("uses the generic chat fallback when Cursor commands are unavailable", () => {
  assert.deepEqual(cursorTransferPolicy([]), {
    canAttach: false,
    openChatCommand: OPEN_GENERIC_CHAT_COMMAND,
  });
});
