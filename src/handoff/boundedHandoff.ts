import { HandoffError } from "./errors";
import { renderHandoffMarkdown } from "./renderMarkdown";
import {
  CharacterTokenEstimator,
  estimateMessagesTokens,
  estimateRepositoryTokens,
  type TokenEstimator,
} from "./tokenBudget";
import type {
  HandoffContext,
  HandoffMessage,
  RepositoryHandoffPayload,
} from "./types";

const TRUNCATED_MESSAGE_PREFIX = "[Message truncated]\n\n";

function cloneContext(context: HandoffContext): HandoffContext {
  return {
    ...context,
    conversation: context.conversation
      ? {
          ...context.conversation,
          messages: context.conversation.messages.map((message) => ({ ...message })),
        }
      : undefined,
    repository: context.repository ? { ...context.repository } : undefined,
    metadata: {
      ...context.metadata,
      stats: context.metadata.stats ? { ...context.metadata.stats } : undefined,
    },
  };
}

export function finalizeHandoffWithinBudget(
  source: HandoffContext,
  maxTokens: number,
  estimator: TokenEstimator = new CharacterTokenEstimator(),
  recoveryFallback?: {
    messages: readonly HandoffMessage[];
    repository: RepositoryHandoffPayload;
    sourceHistoryTruncated: boolean;
    force?: boolean;
  },
): HandoffContext {
  const context = cloneContext(source);
  let initialMessageCount = context.conversation?.messages.length ?? 0;
  let initiallyOmitted = context.metadata.stats?.messagesOmitted ?? 0;
  const estimateRendered = (): number =>
    estimator.estimate(renderHandoffMarkdown(context));

  if (estimateRendered() > maxTokens && context.repository?.diff !== undefined) {
    delete context.repository.diff;
    context.repository.diffTruncated = true;
    context.repository.diffOmittedReason = "token-budget";
  }

  if (
    context.metadata.mode === "delta" &&
    recoveryFallback &&
    (recoveryFallback.force || estimateRendered() > maxTokens)
  ) {
    context.metadata.mode = "recovery";
    context.conversation = {
      ...context.conversation,
      messages: recoveryFallback.messages.map((message) => ({ ...message })),
      truncated: recoveryFallback.sourceHistoryTruncated,
    };
    context.repository = { ...recoveryFallback.repository };
    initialMessageCount = recoveryFallback.messages.length;
    initiallyOmitted = 0;
    if (context.metadata.stats) {
      context.metadata.stats.mode = "recovery";
      context.metadata.stats.continuityReason =
        "Delta exceeded the final payload budget; using bounded recovery.";
    }
    if (estimateRendered() > maxTokens && context.repository.diff !== undefined) {
      delete context.repository.diff;
      context.repository.diffTruncated = true;
      context.repository.diffOmittedReason = "token-budget";
    }
  }

  const messages = context.conversation?.messages;
  while (messages && messages.length > 1 && estimateRendered() > maxTokens) {
    messages.shift();
    context.conversation!.truncated = true;
  }

  if (messages?.length === 1 && estimateRendered() > maxTokens) {
    const message = messages[0];
    const original = message.content;
    context.conversation!.truncated = true;
    let low = 0;
    let high = original.length;
    let best: string | undefined;

    while (low <= high) {
      const length = Math.floor((low + high) / 2);
      const suffix = length === 0 ? "" : original.slice(-length);
      message.content = `${TRUNCATED_MESSAGE_PREFIX}${suffix}`;
      if (estimateRendered() <= maxTokens) {
        best = message.content;
        low = length + 1;
      } else {
        high = length - 1;
      }
    }

    if (best === undefined) {
      messages.length = 0;
    } else {
      message.content = best;
    }
  }

  const finalRenderedTokens = estimateRendered();
  if (finalRenderedTokens > maxTokens) {
    throw new HandoffError(
      "HANDOFF_TOKEN_BUDGET_EXCEEDED",
      `The required handoff framing needs approximately ${finalRenderedTokens} tokens, which exceeds the configured maximum of ${maxTokens}. Increase handoff.maxHandoffTokens and retry.`,
    );
  }

  if (context.metadata.stats) {
    const finalMessages = context.conversation?.messages ?? [];
    const conversationTokens = estimateMessagesTokens(finalMessages, estimator);
    const repositoryTokens = estimateRepositoryTokens(context.repository, estimator);
    context.metadata.stats = {
      ...context.metadata.stats,
      outgoingEstimatedTokens: finalRenderedTokens,
      conversationTokens,
      repositoryTokens,
      metadataTokens: Math.max(
        0,
        finalRenderedTokens - conversationTokens - repositoryTokens,
      ),
      messagesIncluded: finalMessages.length,
      messagesOmitted:
        initiallyOmitted + Math.max(0, initialMessageCount - finalMessages.length),
    };
  }

  return context;
}
