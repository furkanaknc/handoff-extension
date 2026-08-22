import { promises as fs } from "node:fs";
import path from "node:path";
import { HandoffError } from "../handoff/errors";
import type {
  Conversation,
  CursorConversationSource,
} from "../handoff/types";
import {
  normalizeWorkspacePath,
  pointerFileName,
  type CursorConversationPointer,
} from "./pointer";
import {
  parseCursorTranscript,
  type TranscriptLimits,
} from "./transcriptParser";

function isPointer(value: unknown): value is CursorConversationPointer {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<CursorConversationPointer>;
  return (
    candidate.version === 1 &&
    typeof candidate.conversationId === "string" &&
    candidate.conversationId.length > 0 &&
    typeof candidate.transcriptPath === "string" &&
    candidate.transcriptPath.length > 0 &&
    typeof candidate.workspaceRoot === "string" &&
    candidate.workspaceRoot.length > 0 &&
    typeof candidate.updatedAt === "string"
  );
}

export async function readCursorConversationPointer(
  stateDirectory: string,
  workspacePath: string,
): Promise<CursorConversationPointer> {
  const pointerPath = path.join(stateDirectory, pointerFileName(workspacePath));

  let raw: string;
  try {
    raw = await fs.readFile(pointerPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new HandoffError(
        "HOOK_NOT_READY",
        "No active Cursor Agent conversation was captured. Send one message in Cursor Chat after installing the hook, then retry.",
      );
    }
    throw error;
  }

  let pointer: unknown;
  try {
    pointer = JSON.parse(raw);
  } catch (error) {
    throw new HandoffError(
      "POINTER_INVALID",
      "The active Cursor conversation pointer is malformed. Send another Cursor Chat message and retry.",
      { cause: error },
    );
  }

  if (
    !isPointer(pointer) ||
    normalizeWorkspacePath(pointer.workspaceRoot) !==
      normalizeWorkspacePath(workspacePath)
  ) {
    throw new HandoffError(
      "POINTER_INVALID",
      "The captured Cursor conversation does not match the active workspace.",
    );
  }
  return pointer;
}

export class HookCursorConversationSource
  implements CursorConversationSource
{
  constructor(
    private readonly stateDirectory: string,
    private readonly limits: TranscriptLimits,
  ) {}

  async getCurrentConversation(workspacePath: string): Promise<Conversation> {
    const pointer = await readCursorConversationPointer(
      this.stateDirectory,
      workspacePath,
    );

    try {
      const stat = await fs.stat(pointer.transcriptPath);
      if (!stat.isFile()) {
        throw new Error("Transcript path is not a file.");
      }
    } catch (error) {
      throw new HandoffError(
        "TRANSCRIPT_MISSING",
        "Cursor's transcript file is unavailable. Ensure transcripts are enabled, send another message, and retry.",
        { cause: error },
      );
    }

    const conversation = await parseCursorTranscript(
      pointer.transcriptPath,
      pointer.conversationId,
      this.limits,
    );
    if (conversation.messages.length === 0) {
      throw new HandoffError(
        "CONVERSATION_EMPTY",
        "The active Cursor transcript contains no visible user or assistant messages.",
      );
    }
    return conversation;
  }
}
