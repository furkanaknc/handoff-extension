import assert from "node:assert/strict";
import test from "node:test";
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
        async request<T>(method: string) {
          const value =
            method === "thread/list"
              ? {
                  data: [
                    { id: "other", cwd: "C:\\other", source: "vscode" },
                    {
                      id: "X1",
                      cwd: "C:\\work",
                      source: "vscode",
                      name: "Chosen thread",
                    },
                  ],
                }
              : { thread: { id: "X1" } };
          return value as T;
        },
        close() {},
      };
    },
    async pickThread(threads) {
      return threads[0];
    },
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

test("resolves and verifies a workspace-scoped explicitly selected thread", async () => {
  let candidates = 0;
  const result = await resolveCodexTargetSession(
    "C:\\work",
    undefined,
    dependencies({
      async pickThread(threads) {
        candidates = threads.length;
        return threads[0];
      },
    }),
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
    "never",
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
    "always",
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
    ),
    /no longer exists/,
  );
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
