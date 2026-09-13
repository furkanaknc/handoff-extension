import type { HandoffMessage } from "./types";

export interface TokenEstimator {
  estimate(text: string): number;
}

export class CharacterTokenEstimator implements TokenEstimator {
  estimate(text: string): number {
    return Math.ceil(text.length / 4);
  }
}

export interface ConversationBudgetResult {
  messages: HandoffMessage[];
  truncated: boolean;
  messagesIncluded: number;
  messagesOmitted: number;
  conversationTokens: number;
}

function estimateMessageTokens(
  message: HandoffMessage,
  estimator: TokenEstimator,
): number {
  return estimator.estimate(message.content);
}

function isCompleteTurnPair(
  messages: readonly HandoffMessage[],
  startIndex: number,
): boolean {
  if (startIndex <= 0) {
    return true;
  }
  return messages[startIndex - 1].role !== messages[startIndex].role;
}

export function buildConversationWithinBudget(
  messages: readonly HandoffMessage[],
  budget: number,
  estimator: TokenEstimator = new CharacterTokenEstimator(),
): ConversationBudgetResult {
  if (budget <= 0 || messages.length === 0) {
    return {
      messages: [],
      truncated: messages.length > 0,
      messagesIncluded: 0,
      messagesOmitted: messages.length,
      conversationTokens: 0,
    };
  }

  const selected: HandoffMessage[] = [];
  let usedTokens = 0;
  let index = messages.length - 1;
  let contentTruncated = false;

  while (index >= 0) {
    const message = messages[index];
    const messageTokens = estimateMessageTokens(message, estimator);

    if (selected.length === 0 && messageTokens > budget) {
      const prefix = "[Message truncated]\n\n";
      let low = 0;
      let high = message.content.length;
      let truncatedContent = prefix;
      while (low <= high) {
        const length = Math.floor((low + high) / 2);
        const suffix = length === 0 ? "" : message.content.slice(-length);
        const candidate = `${prefix}${suffix}`;
        if (estimator.estimate(candidate) <= budget) {
          truncatedContent = candidate;
          low = length + 1;
        } else {
          high = length - 1;
        }
      }
      selected.unshift({ role: message.role, content: truncatedContent });
      usedTokens = estimator.estimate(truncatedContent);
      contentTruncated = true;
      index -= 1;
      break;
    }

    if (usedTokens + messageTokens > budget) {
      break;
    }

    if (selected.length > 0 && !isCompleteTurnPair(messages, index + 1)) {
      break;
    }

    selected.unshift({ ...message });
    usedTokens += messageTokens;
    index -= 1;
  }

  const messagesIncluded = selected.length;
  const messagesOmitted = messages.length - messagesIncluded;
  const truncated = messagesOmitted > 0 || contentTruncated;

  return {
    messages: selected,
    truncated,
    messagesIncluded,
    messagesOmitted,
    conversationTokens: usedTokens,
  };
}

export function estimateMessagesTokens(
  messages: readonly HandoffMessage[],
  estimator: TokenEstimator = new CharacterTokenEstimator(),
): number {
  return messages.reduce(
    (total, message) => total + estimateMessageTokens(message, estimator),
    0,
  );
}

export function estimateRepositoryTokens(
  repository:
    | {
        branch?: string;
        head?: string;
        changedFiles: readonly string[];
        diffStat?: string;
        diff?: string;
      }
    | undefined,
  estimator: TokenEstimator = new CharacterTokenEstimator(),
): number {
  if (!repository) {
    return 0;
  }
  const parts = [
    repository.branch ?? "",
    repository.head ?? "",
    ...repository.changedFiles,
    repository.diffStat ?? "",
    repository.diff ?? "",
  ];
  return estimator.estimate(parts.join("\n"));
}
