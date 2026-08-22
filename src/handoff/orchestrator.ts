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
  ResolvedTargetSession,
  SessionBinding,
  SyncStateStore,
} from "./types";
import { hashWorkspacePath } from "./syncStateStore";

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
  resolveTargetSession?: (
    workspacePath: string,
    binding?: SessionBinding,
  ) => Promise<ResolvedTargetSession | undefined>;
  now?: () => Date;
  createHandoffId?: () => string;
}

export async function performSynchronizedHandoff(
  options: SynchronizedHandoffOptions,
): Promise<SynchronizedHandoffResult> {
  const [conversation, repository, memory] = await Promise.all([
    options.source.getCurrentConversation(options.workspacePath),
    options.getRepositoryContext(options.workspacePath),
    options.syncStateStore.load(options.workspacePath),
  ]);
  const targetSession = await options.resolveTargetSession?.(
    options.workspacePath,
    memory.sessionBinding,
  );
  const targetSessionId =
    targetSession?.id ??
    (await (options.getTargetSessionId?.(options.workspacePath) ??
      Promise.resolve(undefined)));
  const createdAt = (options.now ?? (() => new Date()))().toISOString();
  const handoffId = (options.createHandoffId ?? randomUUID)();
  const previousState = memory[options.direction];
  const binding = memory.sessionBinding;
  const continuityVerified =
    options.direction === "cursorToCodex"
      ? targetSession !== undefined &&
        conversation.id !== undefined &&
        binding?.cursorConversationId === conversation.id &&
        binding.codexThreadId === targetSession.id &&
        binding.workspaceHash === hashWorkspacePath(options.workspacePath)
      : targetSessionId !== undefined;
  const result = planHandoff({
    conversation,
    repository,
    previousState,
    targetSessionId,
    continuityVerified,
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

  const targetResult = await options.target.sendHandoff(context, targetSession);
  if (targetResult === false) {
    return { status: "manual-transfer", context, messageCount: plan.messages.length };
  }
  let nextBinding: SessionBinding | undefined;
  if (
    options.direction === "cursorToCodex" &&
    targetSession &&
    conversation.id
  ) {
    const samePair =
      binding?.cursorConversationId === conversation.id &&
      binding.codexThreadId === targetSession.id &&
      binding.workspaceHash === hashWorkspacePath(options.workspacePath);
    nextBinding = {
      cursorConversationId: conversation.id,
      codexThreadId: targetSession.id,
      workspaceHash: hashWorkspacePath(options.workspacePath),
      createdAt: samePair && binding ? binding.createdAt : createdAt,
      verifiedAt: createdAt,
      verificationMethod: targetSession.verificationMethod,
    };
  }
  await options.syncStateStore.commitSuccessfulTransfer(
    options.workspacePath,
    options.direction,
    plan.nextSyncState,
    nextBinding,
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
