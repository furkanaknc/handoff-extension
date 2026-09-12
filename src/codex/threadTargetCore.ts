import type {
  ResolvedTargetSession,
  SessionBinding,
} from "../handoff/types";
import { HandoffError } from "../handoff/errors";
import { hashWorkspacePath } from "../handoff/syncStateStore";
import {
  matchingCodexThreads,
  type SelectableCodexThread,
} from "./threadCandidates";

export type CodexRoutingTrust = "auto" | "always" | "never";
export type CodexTargetPreference = "bound" | "new" | "active" | "ask";

const KNOWN_GOOD_ROUTING_VERSIONS = new Set(["26.721.30844"]);

export interface CodexInstallation {
  version: string;
  executablePath: string;
}

export interface AppServerLike {
  connect(): Promise<void>;
  request<T>(method: string, params: unknown): Promise<T>;
  close(): void;
}

export type ThreadPickResult =
  | { kind: "existing"; thread: SelectableCodexThread }
  | { kind: "new" };

export interface ThreadTargetCoreDependencies {
  resolveInstallation(): Promise<CodexInstallation | undefined>;
  createClient(executablePath: string): AppServerLike;
  pickThread(
    threads: readonly SelectableCodexThread[],
    binding?: SessionBinding,
  ): Promise<ThreadPickResult | undefined>;
  openNewChat(): Promise<void>;
  openThread(threadId: string): Promise<boolean>;
  confirmAttachment(label: string): Promise<boolean>;
  warn(message: string): Promise<void>;
}

export interface ResolveCodexTargetSessionOptions {
  routingTrust?: CodexRoutingTrust;
  preference?: CodexTargetPreference;
}

interface ThreadListResult {
  data?: unknown;
}

interface ThreadReadResult {
  thread?: unknown;
}

interface ThreadStartResult {
  thread?: { id?: unknown; name?: unknown; preview?: unknown };
}

function threadFromReadResult(read: ThreadReadResult | undefined): {
  id: string;
  name?: unknown;
  preview?: unknown;
} | undefined {
  if (
    read?.thread === null ||
    typeof read?.thread !== "object" ||
    typeof (read.thread as { id?: unknown }).id !== "string"
  ) {
    return undefined;
  }
  const thread = read.thread as {
    id: string;
    name?: unknown;
    preview?: unknown;
  };
  return thread;
}

async function verifyThreadReadable(
  client: AppServerLike,
  threadId: string,
): Promise<ReturnType<typeof threadFromReadResult>> {
  const read = await client.request<ThreadReadResult>("thread/read", {
    threadId,
    includeTurns: false,
  });
  const thread = threadFromReadResult(read);
  return thread?.id === threadId ? thread : undefined;
}

async function startNewCodexThread(
  client: AppServerLike,
  workspacePath: string,
): Promise<ResolvedTargetSession | undefined> {
  try {
    const started = await client.request<ThreadStartResult>("thread/start", {
      cwd: workspacePath,
      ephemeral: false,
    });
    const newId =
      typeof started?.thread?.id === "string" ? started.thread.id : undefined;
    if (!newId) {
      return undefined;
    }
    const verified = await verifyThreadReadable(client, newId);
    if (!verified) {
      return undefined;
    }
    return {
      id: newId,
      label: codexThreadTitle({
        id: newId,
        name: started.thread?.name,
        preview: started.thread?.preview,
      }),
      verificationMethod: "explicit-selection",
    };
  } catch {
    return undefined;
  }
}

function newChatFallbackSession(): ResolvedTargetSession {
  return {
    id: "",
    label: "New Codex chat",
    verificationMethod: "explicit-selection",
    isNewChat: true,
  };
}

export function codexThreadTitle(thread: SelectableCodexThread): string {
  if (typeof thread.name === "string" && thread.name.trim()) {
    return thread.name.trim();
  }
  if (typeof thread.preview === "string" && thread.preview.trim()) {
    return thread.preview.trim().slice(0, 100);
  }
  return "Untitled Codex thread";
}

export function isKnownGoodCodexRoutingVersion(version: string): boolean {
  return KNOWN_GOOD_ROUTING_VERSIONS.has(version);
}

export function codexThreadRoute(
  uriScheme: string,
  threadId: string,
): string {
  return `${uriScheme}://openai.chatgpt/local/${encodeURIComponent(threadId)}`;
}

export async function probeCodexRoutingCapability(
  client: AppServerLike,
  workspacePath: string,
): Promise<boolean> {
  try {
    const listed = await client.request<ThreadListResult>("thread/list", {
      limit: 5,
      sortKey: "updated_at",
      sortDirection: "desc",
      sourceKinds: ["vscode"],
      cwd: workspacePath,
    });
    const candidates = matchingCodexThreads(listed?.data, workspacePath);
    if (candidates.length === 0) {
      return true;
    }
    const selected = candidates[0];
    return (await verifyThreadReadable(client, selected.id)) !== undefined;
  } catch {
    return false;
  }
}

export async function isCodexRoutingVerified(
  installation: CodexInstallation,
  workspacePath: string,
  trust: CodexRoutingTrust,
  dependencies: ThreadTargetCoreDependencies,
): Promise<boolean> {
  if (trust === "never") {
    return false;
  }
  if (trust === "always") {
    return true;
  }
  if (isKnownGoodCodexRoutingVersion(installation.version)) {
    return true;
  }
  const client = dependencies.createClient(installation.executablePath);
  try {
    await client.connect();
    return probeCodexRoutingCapability(client, workspacePath);
  } catch {
    return false;
  } finally {
    client.close();
  }
}

async function resolveBoundThreadSession(
  client: AppServerLike,
  workspacePath: string,
  binding: SessionBinding,
  candidates: readonly SelectableCodexThread[],
): Promise<ResolvedTargetSession | undefined> {
  if (binding.workspaceHash !== hashWorkspacePath(workspacePath)) {
    return undefined;
  }
  const listed = candidates.find((thread) => thread.id === binding.codexThreadId);
  const verified = await verifyThreadReadable(client, binding.codexThreadId);
  if (!verified) {
    return undefined;
  }
  return {
    id: binding.codexThreadId,
    label: listed
      ? codexThreadTitle(listed)
      : codexThreadTitle({
          id: binding.codexThreadId,
          name: verified.name,
          preview: verified.preview,
        }),
    verificationMethod: "active-state",
  };
}

export async function resolveCodexTargetSession(
  workspacePath: string,
  binding: SessionBinding | undefined,
  dependencies: ThreadTargetCoreDependencies,
  options: ResolveCodexTargetSessionOptions = {},
): Promise<ResolvedTargetSession | undefined> {
  const routingTrust = options.routingTrust ?? "auto";
  const preference = options.preference ?? "bound";

  if (preference === "active") {
    return undefined;
  }

  const installation = await dependencies.resolveInstallation();
  if (!installation) {
    return undefined;
  }

  const verified = await isCodexRoutingVerified(
    installation,
    workspacePath,
    routingTrust,
    dependencies,
  );
  if (!verified) {
    await dependencies.warn(
      `Codex ${installation.version} has not been verified for deterministic thread routing. This handoff will remain bootstrap and will use the active Codex composer.`,
    );
    return undefined;
  }

  const client = dependencies.createClient(installation.executablePath);
  try {
    await client.connect();

    if (preference === "new") {
      const started = await startNewCodexThread(client, workspacePath);
      return started ?? newChatFallbackSession();
    }

    const listed = await client.request<ThreadListResult>("thread/list", {
      limit: 100,
      sortKey: "updated_at",
      sortDirection: "desc",
      sourceKinds: ["vscode"],
      cwd: workspacePath,
    });
    const candidates = matchingCodexThreads(listed?.data, workspacePath);

    if (preference === "bound" && binding) {
      const boundSession = await resolveBoundThreadSession(
        client,
        workspacePath,
        binding,
        candidates,
      );
      if (boundSession) {
        return boundSession;
      }
    }

    if (candidates.length === 0 && preference === "bound") {
      await dependencies.warn(
        "No existing Codex thread was found for this workspace. The active or new Codex composer will receive a bootstrap handoff; binding remains unverified.",
      );
      return undefined;
    }

    const picked = await dependencies.pickThread(candidates, binding);
    if (!picked) {
      throw new HandoffError(
        "THREAD_SELECTION_CANCELLED",
        "Codex thread selection was cancelled.",
      );
    }
    if (picked.kind === "new") {
      const started = await startNewCodexThread(client, workspacePath);
      return started ?? newChatFallbackSession();
    }
    const selected = picked.thread;
    const readThread = await verifyThreadReadable(client, selected.id);
    if (!readThread) {
      throw new HandoffError(
        "CODEX_THREAD_NOT_FOUND",
        "The selected Codex thread no longer exists. Retry and choose another thread.",
      );
    }
    return {
      id: selected.id,
      label: codexThreadTitle(selected),
      verificationMethod: "explicit-selection",
    };
  } finally {
    client.close();
  }
}

export async function prepareCodexTargetSession(
  session: ResolvedTargetSession,
  dependencies: ThreadTargetCoreDependencies,
  skipConfirmation = false,
): Promise<void> {
  if (session.isNewChat) {
    await dependencies.openNewChat();
    if (
      !skipConfirmation &&
      !(await dependencies.confirmAttachment(session.label))
    ) {
      throw new HandoffError(
        "THREAD_SELECTION_CANCELLED",
        "Codex handoff attachment was cancelled.",
      );
    }
    return;
  }
  if (!(await dependencies.openThread(session.id))) {
    throw new HandoffError(
      "CODEX_TRANSFER_FAILED",
      "The selected Codex thread could not be opened.",
    );
  }
  if (
    !skipConfirmation &&
    !(await dependencies.confirmAttachment(session.label))
  ) {
    throw new HandoffError(
      "THREAD_SELECTION_CANCELLED",
      "Codex handoff attachment was cancelled.",
    );
  }
}
