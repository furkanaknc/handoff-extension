import { randomUUID } from "node:crypto";
import { planHandoff } from "./syncPlanner";
import type {
  CodexConversationSource,
  CodexTarget,
  CursorConversationSource,
  CursorTarget,
  HandoffContext,
  HandoffDirection,
  HandoffManifest,
  HandoffMode,
  RepositorySnapshot,
  ResolvedTargetSession,
  SessionBinding,
  SyncStateStore,
} from "./types";
import { hashWorkspacePath } from "./syncStateStore";

export type GitContextProvider = (
  workspacePath: string,
) => Promise<RepositorySnapshot>;

export type SynchronizedHandoffResult =
  | { status: "already-synchronized" }
  | {
      status: "transferred" | "manual-transfer" | "preview";
      context: HandoffContext;
      messageCount: number;
    };

export interface HandoffRuntimeOptions {
  includeFullDiff: boolean;
  maxHandoffTokens: number;
  maxConversationTokens: number;
  legacyMessageCap?: number;
  legacyCharacterCap?: number;
}

interface SynchronizedHandoffOptions {
  workspacePath: string;
  direction: HandoffDirection;
  sourceKind: HandoffContext["source"];
  source: CursorConversationSource | CodexConversationSource;
  target: CodexTarget | CursorTarget;
  getRepositoryContext: GitContextProvider;
  syncStateStore: SyncStateStore;
  runtime: HandoffRuntimeOptions;
  getTargetSessionId?: (workspacePath: string) => Promise<string | undefined>;
  resolveTargetSession?: (
    workspacePath: string,
    binding?: SessionBinding,
  ) => Promise<ResolvedTargetSession | undefined>;
  dryRun?: boolean;
  now?: () => Date;
  createHandoffId?: () => string;
}

function modeDescription(mode: HandoffMode | undefined, messageCount: number): string {
  switch (mode) {
    case "repository-only":
      return "repository changes handed off";
    case "delta":
      return `${messageCount} new message${messageCount === 1 ? "" : "s"} handed off`;
    case "recovery":
      return "bounded recovery context synchronized";
    default:
      return "bootstrap context synchronized";
  }
}

export function describeHandoffResult(
  direction: "Cursor → Codex" | "Codex → Cursor",
  result: SynchronizedHandoffResult,
): string {
  if (result.status === "already-synchronized") {
    return `${direction}: target already has the current source context.`;
  }
  if (result.status === "preview") {
    const stats = result.context.metadata.stats;
    const avoided =
      stats !== undefined
        ? Math.max(0, stats.sourceEstimatedTokens - stats.outgoingEstimatedTokens)
        : 0;
    return `${direction}: preview ${stats?.outgoingEstimatedTokens ?? "?"} tokens (~${avoided} avoided).`;
  }
  const detail = modeDescription(result.context.metadata.mode, result.messageCount);
  const stats = result.context.metadata.stats;
  const tokenSummary =
    stats !== undefined ? ` (~${stats.outgoingEstimatedTokens} tokens)` : "";
  return `${direction}: ${detail}${tokenSummary}.`;
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
    includeFullDiff: options.runtime.includeFullDiff,
    maxHandoffTokens: options.runtime.maxHandoffTokens,
    maxConversationTokens: options.runtime.maxConversationTokens,
    legacyMessageCap: options.runtime.legacyMessageCap,
    legacyCharacterCap: options.runtime.legacyCharacterCap,
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
      truncated: plan.messages.length < conversation.messages.length || conversation.truncated,
      rawOffset: conversation.rawOffset,
      lastTurnId: conversation.lastTurnId,
    },
    repository: plan.repository,
    metadata: {
      createdAt,
      handoffId,
      mode: plan.mode,
      sourceSessionId: conversation.id,
      targetSessionId,
      previousHandoffId:
        plan.mode === "bootstrap" ? undefined : previousState?.lastHandoffId,
      stats: plan.stats,
    },
  };

  if (options.dryRun) {
    return { status: "preview", context, messageCount: plan.messages.length };
  }

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
  const manifest: HandoffManifest = {
    handoffId,
    direction: options.direction,
    mode: plan.mode,
    createdAt,
    stats: plan.stats,
    sourceSessionId: conversation.id,
    targetSessionId,
  };
  await options.syncStateStore.commitSuccessfulTransfer(
    options.workspacePath,
    options.direction,
    plan.nextSyncState,
    nextBinding,
    manifest,
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
    repository: {
      branch: repository.branch,
      head: repository.head,
      changedFiles: repository.changedFiles,
      diffStat: repository.diffStat,
      diff: repository.diff,
      diffTruncated: repository.diffTruncated,
    },
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
    repository: {
      branch: repository.branch,
      head: repository.head,
      changedFiles: repository.changedFiles,
      diffStat: repository.diffStat,
      diff: repository.diff,
      diffTruncated: repository.diffTruncated,
    },
    metadata: { createdAt: now().toISOString() },
  };

  await target.sendHandoff(context);
  return context;
}
