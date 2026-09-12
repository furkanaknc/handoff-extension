import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { CodexAppServerClient } from "../src/codex/appServerClient";
import { HandoffError } from "../src/handoff/errors";

const fixture = path.join(__dirname, "fixtures", "fakeCodexAppServer.js");
const SPAWN_TIMEOUT_MS = 2_000;

function client(mode: string, timeoutMs = SPAWN_TIMEOUT_MS): CodexAppServerClient {
  return new CodexAppServerClient(
    process.execPath,
    [fixture, mode],
    timeoutMs,
  );
}

test("Codex app-server client", { concurrency: 1 }, async (t) => {
  await t.test("performs the app-server handshake and requests", async (t) => {
    const appServer = client("normal");
    t.after(() => appServer.close());
    await appServer.connect();
    const listed = await appServer.request<{ data: Array<{ id: string }> }>(
      "thread/list",
      {},
    );
    assert.equal(listed.data[0].id, "thread-id");
    const read = await appServer.request<{ thread: { id: string } }>(
      "thread/read",
      { threadId: "thread-id", includeTurns: true },
    );
    assert.equal(read.thread.id, "thread-id");
  });

  for (const [mode, code] of [
    ["malformed", "CODEX_PROTOCOL_INVALID"],
    ["timeout", "CODEX_APP_SERVER_FAILED"],
    ["crash", "CODEX_APP_SERVER_FAILED"],
  ] as const) {
    await t.test(`reports ${mode} app-server responses`, async (t) => {
      const appServer = client(mode);
      t.after(() => appServer.close());
      await appServer.connect();
      await assert.rejects(
        appServer.request("thread/list", {}),
        (error) => error instanceof HandoffError && error.code === code,
      );
    });
  }
});
