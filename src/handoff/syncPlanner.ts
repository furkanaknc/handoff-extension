import { createHash } from "node:crypto";
import type {
  Conversation,
  DirectionSyncState,
  GitContext,
  HandoffMessage,
  HandoffPlan,
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

export function fingerprintRepository(repository: GitContext): string {
  return sha256([
    repository.head ?? "",
    repository.branch ?? "",
    ...[...repository.changedFiles].sort(),
    repository.diffStat ?? "",
    repository.diff ?? "",
    repository.diffTruncated ? "truncated" : "complete",
  ]);
}

export interface PlanHandoffInput {
  conversation: Conversation;
  repository: GitContext;
  previousState?: DirectionSyncState;
  targetSessionId?: string;
  continuityVerified: boolean;
  handoffId: string;
  createdAt: string;
}

export type SyncPlanResult =
  | { status: "already-synchronized" }
  | { status: "handoff"; plan: HandoffPlan };

export function planHandoff(input: PlanHandoffInput): SyncPlanResult {
  const { conversation, repository, previousState, targetSessionId } = input;
  const sourceSessionId = conversation.id;
  const repositoryFingerprint = fingerprintRepository(repository);
  const currentMessages = conversation.messages;

  const sourceKnown = typeof sourceSessionId === "string" && sourceSessionId.length > 0;
  const targetKnown =
    typeof targetSessionId === "string" && targetSessionId.length > 0;
  const canCompare =
    input.continuityVerified &&
    sourceKnown &&
    targetKnown &&
    previousState !== undefined &&
    previousState.sourceSessionId === sourceSessionId &&
    previousState.targetSessionId === targetSessionId &&
    currentMessages.length >= previousState.transferredMessageCount &&
    hashMessages(
      currentMessages.slice(0, previousState.transferredMessageCount),
    ) === previousState.transferredPrefixHash;

  let mode: HandoffPlan["mode"] = "full";
  let messages = currentMessages.map((message) => ({ ...message }));
  if (canCompare) {
    messages = currentMessages
      .slice(previousState.transferredMessageCount)
      .map((message) => ({ ...message }));
    if (messages.length > 0) {
      mode = "delta";
    } else if (repositoryFingerprint !== previousState.repositoryFingerprint) {
      mode = "repository-only";
    } else {
      return { status: "already-synchronized" };
    }
  }

  return {
    status: "handoff",
    plan: {
      mode,
      messages,
      repository,
      nextSyncState: {
        sourceSessionId: sourceSessionId ?? "",
        targetSessionId,
        transferredMessageCount: currentMessages.length,
        transferredPrefixHash: hashMessages(currentMessages),
        repositoryFingerprint,
        lastHandoffId: input.handoffId,
        lastHandoffAt: input.createdAt,
        lastMode: mode,
      },
    },
  };
}
