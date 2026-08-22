import { createReadStream } from "node:fs";
import readline from "node:readline";
import type { Conversation, HandoffMessage, HandoffRole } from "../handoff/types";
import {
  isGeneratedHandoffText,
  stripGeneratedHandoffReferences,
} from "../handoff/provenance";

export interface TranscriptLimits {
  maxMessages: number;
  maxCharacters: number;
}

interface TranscriptEvent {
  role?: unknown;
  message?: {
    content?: unknown;
  };
}

function visibleTextFromEvent(event: TranscriptEvent): HandoffMessage | undefined {
  if (event.role !== "user" && event.role !== "assistant") {
    return undefined;
  }
  const content = event.message?.content;
  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .filter(
      (item): item is { type: "text"; text: string } =>
        item !== null &&
        typeof item === "object" &&
        (item as { type?: unknown }).type === "text" &&
        typeof (item as { text?: unknown }).text === "string",
    )
    .map((item) => item.text)
    .filter((value) => value.trim().length > 0)
    .join("\n\n");

  const sanitized = stripGeneratedHandoffReferences(text);
  return sanitized.length > 0 && !isGeneratedHandoffText(sanitized)
    ? { role: event.role as HandoffRole, content: sanitized }
    : undefined;
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

export function applyConversationLimits(
  input: HandoffMessage[],
  limits: TranscriptLimits,
): { messages: HandoffMessage[]; truncated: boolean } {
  const maxMessages = Math.max(1, Math.floor(limits.maxMessages));
  const maxCharacters = Math.max(1, Math.floor(limits.maxCharacters));
  let truncated = input.length > maxMessages;
  const messages = input
    .slice(-maxMessages)
    .map((message) => ({ ...message }));

  let total = messages.reduce((sum, message) => sum + message.content.length, 0);
  while (messages.length > 1 && total > maxCharacters) {
    total -= messages.shift()?.content.length ?? 0;
    truncated = true;
  }

  if (messages.length === 1 && messages[0].content.length > maxCharacters) {
    messages[0].content = messages[0].content.slice(-maxCharacters);
    truncated = true;
  }

  return { messages, truncated };
}

export async function parseCursorTranscript(
  transcriptPath: string,
  conversationId: string | undefined,
  limits: TranscriptLimits,
): Promise<Conversation> {
  const messages: HandoffMessage[] = [];
  const input = createReadStream(transcriptPath, { encoding: "utf8" });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });

  for await (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed !== null && typeof parsed === "object") {
        const message = visibleTextFromEvent(parsed as TranscriptEvent);
        if (message) {
          appendOrCoalesce(messages, message);
        }
      }
    } catch {
      // Cursor may leave a partial final JSONL record during an active turn.
    }
  }

  const limited = applyConversationLimits(messages, limits);
  return {
    id: conversationId,
    messages: limited.messages,
    truncated: limited.truncated,
  };
}
