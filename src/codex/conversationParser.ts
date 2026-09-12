import { applyConversationLimits, type TranscriptLimits } from "../cursor/transcriptParser";
import type { Conversation, HandoffMessage } from "../handoff/types";
import {
  isGeneratedHandoffText,
  stripGeneratedHandoffReferences,
} from "../handoff/provenance";

const IMAGE_PLACEHOLDER = "[User attached an image; image content was not included in this handoff.]";

export interface CodexParserOptions {
  includeCommentary?: boolean;
}

interface CodexItem {
  type?: unknown;
  phase?: unknown;
  text?: unknown;
  content?: unknown;
}

interface CodexTurn {
  id?: unknown;
  status?: unknown;
  items?: unknown;
}

interface CodexThread {
  id?: unknown;
  turns?: unknown;
}

function appendOrCoalesce(
  messages: HandoffMessage[],
  message: HandoffMessage,
): void {
  const previous = messages.at(-1);
  if (previous?.role === message.role) {
    previous.content = `${previous.content}\n\n${message.content}`;
  } else {
    messages.push(message);
  }
}

function userText(item: CodexItem): string | undefined {
  if (!Array.isArray(item.content)) {
    return undefined;
  }
  const text = item.content
    .filter(
      (part): part is { type: "text"; text: string } =>
        part !== null &&
        typeof part === "object" &&
        (part as { type?: unknown }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string",
    )
    .map((part) => part.text)
    .filter((value) => value.trim().length > 0)
    .join("\n\n");
  const sanitized = stripGeneratedHandoffReferences(text);
  if (sanitized.length > 0 && !isGeneratedHandoffText(sanitized)) {
    return sanitized;
  }
  return item.content.some(
    (part) =>
      part !== null &&
      typeof part === "object" &&
      ((part as { type?: unknown }).type === "image" ||
        (part as { type?: unknown }).type === "localImage"),
  )
    ? IMAGE_PLACEHOLDER
    : undefined;
}

function shouldIncludeAgentItem(
  item: CodexItem,
  includeCommentary: boolean,
): boolean {
  if (item.type === "plan") {
    return includeCommentary;
  }
  if (item.type !== "agentMessage" || typeof item.text !== "string") {
    return false;
  }
  if (item.phase === undefined || item.phase === "final_answer") {
    return true;
  }
  return includeCommentary && item.phase === "commentary";
}

export function codexThreadHasActiveTurn(value: unknown): boolean {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const turns = (value as CodexThread).turns;
  return (
    Array.isArray(turns) &&
    turns.some(
      (turn) =>
        turn !== null &&
        typeof turn === "object" &&
        (turn as CodexTurn).status === "inProgress",
    )
  );
}

export function parseCodexThread(
  value: unknown,
  limits: TranscriptLimits,
  options: CodexParserOptions = {},
): Conversation {
  if (value === null || typeof value !== "object") {
    return { messages: [], truncated: false };
  }
  const thread = value as CodexThread;
  const messages: HandoffMessage[] = [];
  const turns = Array.isArray(thread.turns) ? thread.turns : [];
  let lastTurnId: string | undefined;

  for (const turnValue of turns) {
    if (turnValue === null || typeof turnValue !== "object") {
      continue;
    }
    const turn = turnValue as CodexTurn;
    if (typeof turn.id === "string") {
      lastTurnId = turn.id;
    }
    const items = Array.isArray(turn.items) ? turn.items : [];
    for (const itemValue of items) {
      if (itemValue === null || typeof itemValue !== "object") {
        continue;
      }
      const item = itemValue as CodexItem;
      if (item.type === "userMessage") {
        const content = userText(item);
        if (content) {
          appendOrCoalesce(messages, { role: "user", content });
        }
      } else if (shouldIncludeAgentItem(item, options.includeCommentary === true)) {
        const content = stripGeneratedHandoffReferences(item.text as string);
        if (content && !isGeneratedHandoffText(content)) {
          appendOrCoalesce(messages, { role: "assistant", content });
        }
      }
    }
  }

  const limited = applyConversationLimits(messages, limits);
  return {
    id: typeof thread.id === "string" ? thread.id : undefined,
    messages: limited.messages,
    truncated: limited.truncated,
    lastTurnId,
  };
}
