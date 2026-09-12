import { createHash } from "node:crypto";
import {
  buildSourceCheckpoint,
  extractDeltaMessages,
  hashMessage,
  locateDelta,
} from "./sourceCursor";
import {
  buildConversationWithinBudget,
  CharacterTokenEstimator,
  estimateMessagesTokens,
  estimateRepositoryTokens,
  type TokenEstimator,
} from "./tokenBudget";
import type {
  HandoffMessage,
  HandoffMode,
  HandoffPlan,
  HandoffStats,
  PlanHandoffOptions,
  RepositoryHandoffPayload,
  RepositorySnapshot,
} from "./types";

function sha256(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part, "utf8");
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

export function hashMessages(messages: readonly HandoffMessage[]): string {
  return sha256(messages.flatMap((message) => [message.role, message.content]));
}

export function fingerprintRepository(repository: RepositorySnapshot): string {
  return sha256([
    repository.head ?? "",
    repository.branch ?? "",
    ...[...repository.changedFiles].sort(),
    repository.diffStat ?? "",
    repository.diffHash ?? "",
    repository.diffTruncated ? "truncated" : "complete",
  ]);
}

export function toRepositoryHandoffPayload(
  repository: RepositorySnapshot,
  includeFullDiff: boolean,
): RepositoryHandoffPayload {
  return {
    branch: repository.branch,
    head: repository.head,
    changedFiles: [],
    ...(includeFullDiff && repository.diff
      ? { diff: repository.diff, diffTruncated: repository.diffTruncated }
      : {}),
  };
}

function applyLegacyCaps(
  messages: HandoffMessage[],
  legacyMessageCap?: number,
  legacyCharacterCap?: number,
): HandoffMessage[] {
  let capped = messages.map((message) => ({ ...message }));
  if (legacyMessageCap !== undefined && legacyMessageCap > 0) {
    capped = capped.slice(-Math.floor(legacyMessageCap));
  }
  if (legacyCharacterCap !== undefined && legacyCharacterCap > 0) {
    let total = capped.reduce((sum, message) => sum + message.content.length, 0);
    while (capped.length > 1 && total > legacyCharacterCap) {
      total -= capped.shift()?.content.length ?? 0;
    }
    if (capped.length === 1 && capped[0].content.length > legacyCharacterCap) {
      capped[0].content = capped[0].content.slice(-legacyCharacterCap);
    }
  }
  return capped;
}

function buildStats(
  mode: HandoffMode,
  sourceMessages: readonly HandoffMessage[],
  outgoingMessages: readonly HandoffMessage[],
  repository: RepositoryHandoffPayload | undefined,
  metadataTokens: number,
  continuityReason: string,
  estimator: TokenEstimator,
): HandoffStats {
  const conversationTokens = estimateMessagesTokens(outgoingMessages, estimator);
  const repositoryTokens = estimateRepositoryTokens(repository, estimator);
  const outgoingEstimatedTokens =
    conversationTokens + repositoryTokens + metadataTokens;
  return {
    mode,
    continuityReason,
    sourceEstimatedTokens: estimateMessagesTokens(sourceMessages, estimator),
    outgoingEstimatedTokens,
    conversationTokens,
    repositoryTokens,
    metadataTokens,
    messagesIncluded: outgoingMessages.length,
    messagesOmitted: Math.max(0, sourceMessages.length - outgoingMessages.length),
  };
}

export type SyncPlanResult =
  | { status: "already-synchronized" }
  | { status: "handoff"; plan: HandoffPlan };

export function planHandoff(input: PlanHandoffOptions): SyncPlanResult {
  const {
    conversation,
    repository,
    previousState,
    targetSessionId,
    includeFullDiff,
    maxHandoffTokens,
    maxConversationTokens,
  } = input;
  const estimator = new CharacterTokenEstimator();
  const metadataTokens = 120;
  const repositoryFingerprint = fingerprintRepository(repository);
  const sourceSessionId = conversation.id;
  const currentMessages = conversation.messages;

  const sourceKnown = typeof sourceSessionId === "string" && sourceSessionId.length > 0;
  const targetKnown =
    typeof targetSessionId === "string" && targetSessionId.length > 0;
  const sessionMatches =
    previousState !== undefined &&
    previousState.sourceSessionId === sourceSessionId &&
    previousState.targetSessionId === targetSessionId;

  let mode: HandoffMode = "bootstrap";
  let continuityReason = "No previous sync state.";
  let rawMessages: HandoffMessage[] = currentMessages.map((message) => ({
    ...message,
  }));

  if (
    input.continuityVerified &&
    sourceKnown &&
    targetKnown &&
    sessionMatches &&
    previousState
  ) {
    if (previousState.sourceCheckpoint) {
      const location = locateDelta(currentMessages, previousState.sourceCheckpoint);
      if (location.kind === "delta") {
        rawMessages = extractDeltaMessages(currentMessages, location);
        mode = rawMessages.length > 0 ? "delta" : "repository-only";
        continuityReason = "Matched source checkpoint anchors.";
      } else {
        mode = "recovery";
        continuityReason = "Source checkpoint anchors were not found.";
      }
    } else {
      mode = "recovery";
      continuityReason = "Legacy sync state without checkpoint; using bounded recovery.";
    }
  } else if (previousState && sessionMatches) {
    mode = "bootstrap";
    continuityReason = "Continuity was not verified for this transfer.";
  }

  if (
    mode === "repository-only" &&
    repositoryFingerprint === previousState?.repositoryFingerprint
  ) {
    return { status: "already-synchronized" };
  }

  if (mode === "delta" && rawMessages.length === 0) {
    if (repositoryFingerprint !== previousState?.repositoryFingerprint) {
      mode = "repository-only";
    } else {
      return { status: "already-synchronized" };
    }
  }

  const includeRepository =
    mode !== "delta" ||
    repositoryFingerprint !== previousState?.repositoryFingerprint;
  const repositoryPayload = includeRepository
    ? toRepositoryHandoffPayload(repository, includeFullDiff)
    : undefined;

  let budgetedMessages = rawMessages;
  let truncated = conversation.truncated;
  let messagesIncluded = rawMessages.length;
  let messagesOmitted = 0;
  let conversationTokens = estimateMessagesTokens(rawMessages, estimator);

  if (mode === "bootstrap" || mode === "recovery") {
    const legacyCapped = applyLegacyCaps(
      rawMessages,
      input.legacyMessageCap,
      input.legacyCharacterCap,
    );
    const budget = buildConversationWithinBudget(
      legacyCapped,
      maxConversationTokens,
      estimator,
    );
    budgetedMessages = budget.messages;
    truncated = budget.truncated || conversation.truncated;
    messagesIncluded = budget.messagesIncluded;
    messagesOmitted = budget.messagesOmitted;
    conversationTokens = budget.conversationTokens;
  } else if (mode === "delta") {
    budgetedMessages = rawMessages;
    messagesIncluded = rawMessages.length;
    messagesOmitted = 0;
    conversationTokens = estimateMessagesTokens(rawMessages, estimator);
  }

  const repositoryTokens = estimateRepositoryTokens(repositoryPayload, estimator);
  let outgoingEstimatedTokens =
    conversationTokens + repositoryTokens + metadataTokens;

  if (outgoingEstimatedTokens > maxHandoffTokens && budgetedMessages.length > 0) {
    const availableConversationBudget = Math.max(
      0,
      maxHandoffTokens - repositoryTokens - metadataTokens,
    );
    const budget = buildConversationWithinBudget(
      budgetedMessages,
      availableConversationBudget,
      estimator,
    );
    budgetedMessages = budget.messages;
    truncated = budget.truncated || truncated;
    messagesIncluded = budget.messagesIncluded;
    messagesOmitted += budget.messagesOmitted;
    conversationTokens = budget.conversationTokens;
    outgoingEstimatedTokens =
      conversationTokens + repositoryTokens + metadataTokens;
  }

  const stats: HandoffStats = {
    mode,
    continuityReason,
    sourceEstimatedTokens: estimateMessagesTokens(currentMessages, estimator),
    outgoingEstimatedTokens,
    conversationTokens,
    repositoryTokens,
    metadataTokens,
    messagesIncluded,
    messagesOmitted,
  };

  const nextCheckpoint = buildSourceCheckpoint(
    currentMessages,
    conversation.rawOffset,
    conversation.lastTurnId,
  );

  return {
    status: "handoff",
    plan: {
      mode,
      messages: budgetedMessages,
      repository: repositoryPayload,
      continuityReason,
      stats,
      nextSyncState: {
        sourceSessionId: sourceSessionId ?? "",
        targetSessionId,
        sourceCheckpoint: nextCheckpoint,
        repositoryFingerprint,
        lastHandoffId: input.handoffId,
        lastHandoffAt: input.createdAt,
        lastMode: mode,
      },
    },
  };
}

export { hashMessage };
