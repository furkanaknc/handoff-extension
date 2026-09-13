import assert from "node:assert/strict";
import test from "node:test";
import { hashWorkspacePath } from "../src/handoff/syncStateStore";
import {
  codexThreadRoute,
  isKnownGoodCodexRoutingVersion,
  prepareCodexTargetSession,
  probeCodexRoutingCapability,
  resolveCodexTargetSession,
  type ThreadTargetCoreDependencies,
} from "../src/codex/threadTargetCore";

function dependencies(
  overrides: Partial<ThreadTargetCoreDependencies> = {},
): ThreadTargetCoreDependencies {
  return {
    async resolveInstallation() {
      return { version: "26.721.30844", executablePath: "codex.exe" };
    },
    createClient() {
      return {
        async connect() {},
        async request<T>(method: string, params?: unknown) {
          if (method === "thread/list") {
            return {
              data: [
                { id: "other", cwd: "C:\\other", source: "vscode" },
                {
                  id: "X1",
                  cwd: "C:\\work",
                  source: "vscode",
                  name: "Chosen thread",
                },
              ],
            } as T;
          }
          if (method === "thread/start") {
            const cwd = (params as { cwd?: string } | undefined)?.cwd;
            return {
              thread: {
                id: "NEW1",
                name: "Started thread",
                cwd,
                source: "vscode",
              },
            } as T;
          }
          const threadId = (params as { threadId?: string } | undefined)?.threadId;
          if (threadId === "deleted") {
            return { thread: { id: "deleted" } } as T;
          }
          if (threadId === "missing") {
            return { thread: null } as T;
          }
          return { thread: { id: threadId ?? "X1" } } as T;
        },
        close() {},
      };
    },
    async pickThread(threads) {
      return { kind: "existing", thread: threads[0] };
    },
    async openNewChat() {},
    async openThread() {
      return true;
    },
    async confirmAttachment() {
      return true;
    },
    async warn() {},
    ...overrides,
  };
}

const binding = {
  cursorConversationId: "cursor-1",
  codexThreadId: "X1",
  workspaceHash: hashWorkspacePath("C:\\work"),
  createdAt: "2026-09-13T00:00:00.000Z",
  verifiedAt: "2026-09-13T00:00:00.000Z",
  verificationMethod: "explicit-selection" as const,
};

test("resolves and verifies a workspace-scoped explicitly selected thread", async () => {
  let candidates = 0;
  const result = await resolveCodexTargetSession(
    "C:\\work",
    undefined,
    dependencies({
      async pickThread(threads) {
        candidates = threads.length;
        return { kind: "existing", thread: threads[0] };
      },
    }),
    { preference: "ask" },
  );
  assert.equal(candidates, 1);
  assert.deepEqual(result, {
    id: "X1",
    label: "Chosen thread",
    verificationMethod: "explicit-selection",
  });
  assert.equal(
    codexThreadRoute("cursor", "thread id"),
    "cursor://openai.chatgpt/local/thread%20id",
  );
});

test("auto-selects a bound thread without opening the picker", async () => {
  let pickCount = 0;
  const result = await resolveCodexTargetSession(
    "C:\\work",
    binding,
    dependencies({
      async pickThread() {
        pickCount += 1;
        return { kind: "existing", thread: { id: "other" } };
      },
    }),
    { preference: "bound" },
  );
  assert.equal(pickCount, 0);
  assert.deepEqual(result, {
    id: "X1",
    label: "Chosen thread",
    verificationMethod: "active-state",
  });
});

test("falls back to the picker when the bound workspace hash does not match", async () => {
  let pickCount = 0;
  await resolveCodexTargetSession(
    "C:\\work",
    { ...binding, workspaceHash: hashWorkspacePath("C:\\other") },
    dependencies({
      async pickThread() {
        pickCount += 1;
        return { kind: "existing", thread: { id: "X1", cwd: "C:\\work" } };
      },
    }),
    { preference: "bound" },
  );
  assert.equal(pickCount, 1);
});

test("falls back to the picker when the bound thread cannot be read", async () => {
  let pickCount = 0;
  await resolveCodexTargetSession(
    "C:\\work",
    { ...binding, codexThreadId: "missing" },
    dependencies({
      async pickThread() {
        pickCount += 1;
        return { kind: "existing", thread: { id: "X1", cwd: "C:\\work" } };
      },
    }),
    { preference: "bound" },
  );
  assert.equal(pickCount, 1);
});

test("probes routing capability for unknown Codex versions", async () => {
  const client = dependencies().createClient("codex.exe");
  await client.connect();
  assert.equal(await probeCodexRoutingCapability(client, "C:\\work"), true);
  client.close();
});

test("falls back to an unverified target when routing trust is never", async () => {
  let warned = false;
  const result = await resolveCodexTargetSession(
    "C:\\work",
    undefined,
    dependencies({
      async resolveInstallation() {
        return { version: "99.0.0", executablePath: "codex.exe" };
      },
      async warn() {
        warned = true;
      },
    }),
    { routingTrust: "never" },
  );
  assert.equal(result, undefined);
  assert.equal(warned, true);
});

test("allows unknown versions when routing trust is always", async () => {
  const result = await resolveCodexTargetSession(
    "C:\\work",
    undefined,
    dependencies({
      async resolveInstallation() {
        return { version: "99.0.0", executablePath: "codex.exe" };
      },
    }),
    { routingTrust: "always", preference: "ask" },
  );
  assert.equal(result?.id, "X1");
});

test("treats inspected version as known-good", () => {
  assert.equal(isKnownGoodCodexRoutingVersion("26.721.30844"), true);
  assert.equal(isKnownGoodCodexRoutingVersion("99.0.0"), false);
});

test("reports selection cancellation and a stale selected thread", async () => {
  await assert.rejects(
    resolveCodexTargetSession(
      "C:\\work",
      undefined,
      dependencies({ async pickThread() { return undefined; } }),
      { preference: "ask" },
    ),
    /selection was cancelled/,
  );
  await assert.rejects(
    resolveCodexTargetSession(
      "C:\\work",
      undefined,
      dependencies({
        createClient() {
          return {
            async connect() {},
            async request<T>(method: string) {
              return (method === "thread/list"
                ? { data: [{ id: "X1", cwd: "C:\\work", source: "vscode" }] }
                : { thread: { id: "deleted" } }) as T;
            },
            close() {},
          };
        },
      }),
      { preference: "ask" },
    ),
    /no longer exists/,
  );
});

test("starts a new Codex thread via thread/start when requested", async () => {
  let pickCount = 0;
  const result = await resolveCodexTargetSession(
    "C:\\work",
    undefined,
    dependencies({
      async pickThread() {
        pickCount += 1;
        return undefined;
      },
    }),
    { preference: "new" },
  );
  assert.equal(pickCount, 0);
  assert.deepEqual(result, {
    id: "NEW1",
    label: "Started thread",
    verificationMethod: "explicit-selection",
  });
});

test("falls back to newChat when thread/start cannot be verified", async () => {
  const result = await resolveCodexTargetSession(
    "C:\\work",
    undefined,
    dependencies({
      createClient() {
        return {
          async connect() {},
          async request<T>(method: string) {
            if (method === "thread/start") {
              return { thread: { id: "NEW1" } } as T;
            }
            if (method === "thread/read") {
              return { thread: null } as T;
            }
            return { data: [] } as T;
          },
          close() {},
        };
      },
      async pickThread() {
        return { kind: "new" };
      },
    }),
    { preference: "ask" },
  );
  assert.deepEqual(result, {
    id: "",
    label: "New Codex chat",
    verificationMethod: "explicit-selection",
    isNewChat: true,
  });
});

test("opens a new Codex chat when picker requests new and thread/start succeeds", async () => {
  let openedNewChat = false;
  const result = await resolveCodexTargetSession(
    "C:\\work",
    undefined,
    dependencies({
      async pickThread() {
        return { kind: "new" };
      },
      async openNewChat() {
        openedNewChat = true;
      },
    }),
    { preference: "ask" },
  );
  assert.deepEqual(result, {
    id: "NEW1",
    label: "Started thread",
    verificationMethod: "explicit-selection",
  });
  await prepareCodexTargetSession(
    { id: "", label: "New Codex chat", verificationMethod: "explicit-selection", isNewChat: true },
    dependencies({ async openNewChat() { openedNewChat = true; } }),
  );
  assert.equal(openedNewChat, true);
});

test("requires the selected thread to open and receive explicit confirmation", async () => {
  const session = {
    id: "X1",
    label: "Thread",
    verificationMethod: "explicit-selection" as const,
  };
  await assert.rejects(
    prepareCodexTargetSession(
      session,
      dependencies({ async openThread() { return false; } }),
    ),
    /could not be opened/,
  );
  await assert.rejects(
    prepareCodexTargetSession(
      session,
      dependencies({ async confirmAttachment() { return false; } }),
    ),
    /attachment was cancelled/,
  );
});

test("skips attachment confirmation when requested", async () => {
  let confirmCount = 0;
  await prepareCodexTargetSession(
    {
      id: "X1",
      label: "Thread",
      verificationMethod: "explicit-selection",
    },
    dependencies({
      async confirmAttachment() {
        confirmCount += 1;
        return true;
      },
    }),
    true,
  );
  assert.equal(confirmCount, 0);
});

test("returns undefined for active target preference", async () => {
  let connectCount = 0;
  const result = await resolveCodexTargetSession(
    "C:\\work",
    binding,
    dependencies({
      createClient() {
        connectCount += 1;
        return dependencies().createClient("codex.exe");
      },
    }),
    { preference: "active" },
  );
  assert.equal(result, undefined);
  assert.equal(connectCount, 0);
});
