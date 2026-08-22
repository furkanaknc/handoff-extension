import { applyConversationLimits, type TranscriptLimits } from "../cursor/transcriptParser";
import type { Conversation, HandoffMessage } from "../handoff/types";
import {
  isGeneratedHandoffText,
  stripGeneratedHandoffReferences,
} from "../handoff/provenance";

const IMAGE_PLACEHOLDER = "[User attached an image; image content was not included in this handoff.]";

interface CodexItem {
  type?: unknown;
  phase?: unknown;
  text?: unknown;
  content?: unknown;
}

interface CodexTurn {
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
): Conversation {
  if (value === null || typeof value !== "object") {
    return { messages: [], truncated: false };
  }
  const thread = value as CodexThread;
  const messages: HandoffMessage[] = [];
  const turns = Array.isArray(thread.turns) ? thread.turns : [];

  for (const turnValue of turns) {
    if (turnValue === null || typeof turnValue !== "object") {
      continue;
    }
    const items = Array.isArray((turnValue as CodexTurn).items)
      ? ((turnValue as CodexTurn).items as unknown[])
      : [];
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
      } else if (
        item.type === "agentMessage" &&
        typeof item.text === "string" &&
        item.text.trim().length > 0 &&
        (item.phase === undefined ||
          item.phase === "commentary" ||
          item.phase === "final_answer")
      ) {
        const content = stripGeneratedHandoffReferences(item.text);
        if (content && !isGeneratedHandoffText(content)) {
          appendOrCoalesce(messages, { role: "assistant", content });
        }
      } else if (
        item.type === "plan" &&
        typeof item.text === "string" &&
        item.text.trim().length > 0
      ) {
        const content = stripGeneratedHandoffReferences(item.text);
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
  };
}
