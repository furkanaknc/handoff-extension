import { createHash } from "node:crypto";
import type { HandoffMessage } from "./types";

const DEFAULT_ANCHOR_COUNT = 5;

export interface SourceCheckpoint {
  anchorHashes: string[];
  lastMessageLength: number;
  rawOffset?: number;
  lastTurnId?: string;
}

export type DeltaLocation =
  | { kind: "delta"; startIndex: number; tailCharOffset: number }
  | { kind: "recovery" };

function sha256(parts: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of parts) {
    hash.update(part, "utf8");
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

export function hashMessage(message: HandoffMessage): string {
  return sha256([message.role, message.content]);
}

export function buildSourceCheckpoint(
  messages: readonly HandoffMessage[],
  rawOffset?: number,
  lastTurnId?: string,
  anchorCount = DEFAULT_ANCHOR_COUNT,
): SourceCheckpoint | undefined {
  if (messages.length === 0) {
    return undefined;
  }
  const anchors = messages.slice(-Math.min(anchorCount, messages.length));
  return {
    anchorHashes: anchors.map((message) => hashMessage(message)),
    lastMessageLength: messages.at(-1)?.content.length ?? 0,
    ...(rawOffset !== undefined ? { rawOffset } : {}),
    ...(lastTurnId !== undefined ? { lastTurnId } : {}),
  };
}

function messageMatchesAnchor(
  message: HandoffMessage,
  anchorHash: string,
  expectedLength?: number,
): boolean {
  if (hashMessage(message) === anchorHash) {
    return true;
  }
  if (
    expectedLength !== undefined &&
    message.content.length >= expectedLength &&
    expectedLength > 0
  ) {
    return (
      hashMessage({
        role: message.role,
        content: message.content.slice(0, expectedLength),
      }) === anchorHash
    );
  }
  return false;
}

function anchorsMatchAt(
  messages: readonly HandoffMessage[],
  startIndex: number,
  checkpoint: SourceCheckpoint,
): boolean {
  const { anchorHashes, lastMessageLength } = checkpoint;
  if (startIndex < 0 || startIndex + anchorHashes.length > messages.length) {
    return false;
  }
  for (let index = 0; index < anchorHashes.length; index += 1) {
    const message = messages[startIndex + index];
    const isLast = index === anchorHashes.length - 1;
    if (
      !messageMatchesAnchor(
        message,
        anchorHashes[index],
        isLast ? lastMessageLength : undefined,
      )
    ) {
      return false;
    }
  }
  return true;
}

export function locateDelta(
  messages: readonly HandoffMessage[],
  checkpoint: SourceCheckpoint | undefined,
): DeltaLocation {
  if (!checkpoint || checkpoint.anchorHashes.length === 0 || messages.length === 0) {
    return { kind: "recovery" };
  }

  let matchedStart = -1;
  for (
    let startIndex = messages.length - checkpoint.anchorHashes.length;
    startIndex >= 0;
    startIndex -= 1
  ) {
    if (anchorsMatchAt(messages, startIndex, checkpoint)) {
      matchedStart = startIndex;
      break;
    }
  }

  if (matchedStart < 0) {
    return { kind: "recovery" };
  }

  const lastAnchorIndex = matchedStart + checkpoint.anchorHashes.length - 1;
  const lastMessage = messages[lastAnchorIndex];
  if (lastMessage.content.length > checkpoint.lastMessageLength) {
    return {
      kind: "delta",
      startIndex: lastAnchorIndex,
      tailCharOffset: checkpoint.lastMessageLength,
    };
  }

  return {
    kind: "delta",
    startIndex: lastAnchorIndex + 1,
    tailCharOffset: 0,
  };
}

export function extractDeltaMessages(
  messages: readonly HandoffMessage[],
  location: Extract<DeltaLocation, { kind: "delta" }>,
): HandoffMessage[] {
  if (location.startIndex >= messages.length) {
    return [];
  }

  const delta: HandoffMessage[] = [];
  const first = messages[location.startIndex];
  if (location.tailCharOffset > 0) {
    const suffix = first.content.slice(location.tailCharOffset).trimStart();
    if (suffix.length > 0) {
      delta.push({ role: first.role, content: suffix });
    }
  } else {
    delta.push({ ...first });
  }

  for (let index = location.startIndex + 1; index < messages.length; index += 1) {
    delta.push({ ...messages[index] });
  }
  return delta;
}
