import { randomUUID } from "node:crypto";
import { planHandoff } from "./syncPlanner";
import type {
  CodexConversationSource,
  CodexTarget,
  CursorConversationSource,
  CursorTarget,
  GitContext,
  HandoffContext,
  HandoffDirection,
  SyncStateStore,
} from "./types";

export type GitContextProvider = (
  workspacePath: string,
) => Promise<GitContext>;

export type SynchronizedHandoffResult =
  | { status: "already-synchronized" }
  | {
      status: "transferred" | "manual-transfer";
      context: HandoffContext;
      messageCount: number;
    };

interface SynchronizedHandoffOptions {
  workspacePath: string;
  direction: HandoffDirection;
  sourceKind: HandoffContext["source"];
  source: CursorConversationSource | CodexConversationSource;
  target: CodexTarget | CursorTarget;
  getRepositoryContext: GitContextProvider;
  syncStateStore: SyncStateStore;
  getTargetSessionId?: (workspacePath: string) => Promise<string | undefined>;
  now?: () => Date;
  createHandoffId?: () => string;
}

export async function performSynchronizedHandoff(
  options: SynchronizedHandoffOptions,
): Promise<SynchronizedHandoffResult> {
  const [conversation, repository, memory, targetSessionId] = await Promise.all([
    options.source.getCurrentConversation(options.workspacePath),
    options.getRepositoryContext(options.workspacePath),
    options.syncStateStore.load(options.workspacePath),
    options.getTargetSessionId?.(options.workspacePath) ??
      Promise.resolve(undefined),
  ]);
  const createdAt = (options.now ?? (() => new Date()))().toISOString();
  const handoffId = (options.createHandoffId ?? randomUUID)();
  const previousState = memory[options.direction];
  const result = planHandoff({
    conversation,
    repository,
    previousState,
    targetSessionId,
    handoffId,
    createdAt,
  });
  if (result.status === "already-synchronized") {
    return result;
  }

  const { plan } = result;
  const context: HandoffContext = {
    source: options.sourceKind,
    workspacePath: options.workspacePath,
    conversation: {
      id: conversation.id,
      messages: plan.messages,
      truncated: plan.mode === "full" && conversation.truncated,
    },
    repository: plan.repository,
    metadata: {
      createdAt,
      handoffId,
      mode: plan.mode,
      sourceSessionId: conversation.id,
      targetSessionId,
      previousHandoffId:
        plan.mode === "full" ? undefined : previousState?.lastHandoffId,
    },
  };

  const targetResult = await options.target.sendHandoff(context);
  if (targetResult === false) {
    return { status: "manual-transfer", context, messageCount: plan.messages.length };
  }
  await options.syncStateStore.saveDirection(
    options.workspacePath,
    options.direction,
    plan.nextSyncState,
  );
  return { status: "transferred", context, messageCount: plan.messages.length };
}

export async function performCursorToCodexHandoff(
  workspacePath: string,
  source: CursorConversationSource,
  target: CodexTarget,
  getRepositoryContext: GitContextProvider,
  now: () => Date = () => new Date(),
): Promise<HandoffContext> {
  const [conversation, repository] = await Promise.all([
    source.getCurrentConversation(workspacePath),
    getRepositoryContext(workspacePath),
  ]);

  const context: HandoffContext = {
    source: "cursor",
    workspacePath,
    conversation,
    repository,
    metadata: { createdAt: now().toISOString() },
  };

  await target.sendHandoff(context);
  return context;
}

export async function performCodexToCursorHandoff(
  workspacePath: string,
  source: CodexConversationSource,
  target: CursorTarget,
  getRepositoryContext: GitContextProvider,
  now: () => Date = () => new Date(),
): Promise<HandoffContext> {
  const [conversation, repository] = await Promise.all([
    source.getCurrentConversation(workspacePath),
    getRepositoryContext(workspacePath),
  ]);

  const context: HandoffContext = {
    source: "codex",
    workspacePath,
    conversation,
    repository,
    metadata: { createdAt: now().toISOString() },
  };

  await target.sendHandoff(context);
  return context;
}
