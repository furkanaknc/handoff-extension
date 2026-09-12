import type {
  ResolvedTargetSession,
  SessionBinding,
} from "../handoff/types";
import { HandoffError } from "../handoff/errors";
import {
  matchingCodexThreads,
  type SelectableCodexThread,
} from "./threadCandidates";

export type CodexRoutingTrust = "auto" | "always" | "never";

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

export interface ThreadTargetCoreDependencies {
  resolveInstallation(): Promise<CodexInstallation | undefined>;
  createClient(executablePath: string): AppServerLike;
  pickThread(
    threads: readonly SelectableCodexThread[],
    binding?: SessionBinding,
  ): Promise<SelectableCodexThread | undefined>;
  openThread(threadId: string): Promise<boolean>;
  confirmAttachment(label: string): Promise<boolean>;
  warn(message: string): Promise<void>;
}

interface ThreadListResult {
  data?: unknown;
}

interface ThreadReadResult {
  thread?: unknown;
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
    const read = await client.request<ThreadReadResult>("thread/read", {
      threadId: selected.id,
      includeTurns: false,
    });
    return (
      read?.thread !== null &&
      typeof read?.thread === "object" &&
      (read.thread as { id?: unknown }).id === selected.id
    );
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

export async function resolveCodexTargetSession(
  workspacePath: string,
  binding: SessionBinding | undefined,
  dependencies: ThreadTargetCoreDependencies,
  routingTrust: CodexRoutingTrust = "auto",
): Promise<ResolvedTargetSession | undefined> {
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
    const listed = await client.request<ThreadListResult>("thread/list", {
      limit: 100,
      sortKey: "updated_at",
      sortDirection: "desc",
      sourceKinds: ["vscode"],
      cwd: workspacePath,
    });
    const candidates = matchingCodexThreads(listed?.data, workspacePath);
    if (candidates.length === 0) {
      await dependencies.warn(
        "No existing Codex thread was found for this workspace. The active or new Codex composer will receive a bootstrap handoff; binding remains unverified.",
      );
      return undefined;
    }
    const selected = await dependencies.pickThread(candidates, binding);
    if (!selected) {
      throw new HandoffError(
        "THREAD_SELECTION_CANCELLED",
        "Codex thread selection was cancelled.",
      );
    }
    const read = await client.request<ThreadReadResult>("thread/read", {
      threadId: selected.id,
      includeTurns: false,
    });
    if (
      read?.thread === null ||
      typeof read?.thread !== "object" ||
      (read.thread as { id?: unknown }).id !== selected.id
    ) {
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
): Promise<void> {
  if (!(await dependencies.openThread(session.id))) {
    throw new HandoffError(
      "CODEX_TRANSFER_FAILED",
      "The selected Codex thread could not be opened.",
    );
  }
  if (!(await dependencies.confirmAttachment(session.label))) {
    throw new HandoffError(
      "THREAD_SELECTION_CANCELLED",
      "Codex handoff attachment was cancelled.",
    );
  }
}
