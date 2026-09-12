import * as vscode from "vscode";
import { HandoffError } from "../handoff/errors";
import type { CodexConversationSource, Conversation } from "../handoff/types";
import { CodexAppServerClient } from "./appServerClient";
import { resolveCodexExecutable } from "./codexInstallation";
import {
  codexThreadHasActiveTurn,
  parseCodexThread,
  type CodexParserOptions,
} from "./conversationParser";
import type { TranscriptLimits } from "../cursor/transcriptParser";
import {
  matchingCodexThreads,
  type CodexThreadSummary as ThreadSummary,
} from "./threadCandidates";

const CODEX_EXTENSION_ID = "openai.chatgpt";

interface ThreadListResult {
  data?: unknown;
}

interface ThreadReadResult {
  thread?: unknown;
}

function threadTitle(thread: ThreadSummary): string {
  if (typeof thread.name === "string" && thread.name.trim().length > 0) {
    return thread.name.trim();
  }
  if (typeof thread.preview === "string" && thread.preview.trim().length > 0) {
    return thread.preview.trim().slice(0, 100);
  }
  return "Untitled Codex thread";
}

function updatedDescription(thread: ThreadSummary): string | undefined {
  if (typeof thread.updatedAt !== "number") {
    return undefined;
  }
  return `Updated ${new Date(thread.updatedAt * 1000).toLocaleString()}`;
}

export class OfficialCodexConversationSource
  implements CodexConversationSource
{
  constructor(
    private readonly limits: TranscriptLimits,
    private readonly parserOptions: CodexParserOptions = {},
  ) {}

  async getCurrentConversation(workspacePath: string): Promise<Conversation> {
    const extension = vscode.extensions.getExtension(CODEX_EXTENSION_ID);
    if (!extension) {
      throw new HandoffError(
        "CODEX_NOT_INSTALLED",
        "The official OpenAI Codex extension is not installed in Cursor.",
      );
    }
    await extension.activate();

    const executablePath = await resolveCodexExecutable(extension.extensionPath);
    if (!executablePath) {
      throw new HandoffError(
        "CODEX_APP_SERVER_MISSING",
        "The installed Codex extension does not contain its bundled app-server.",
      );
    }

    const client = new CodexAppServerClient(executablePath);
    try {
      await client.connect();
      const result = await client.request<ThreadListResult>("thread/list", {
        limit: 100,
        sortKey: "updated_at",
        sortDirection: "desc",
        sourceKinds: ["vscode"],
        cwd: workspacePath,
      });
      const candidates = matchingCodexThreads(result?.data, workspacePath);

      if (candidates.length === 0) {
        throw new HandoffError(
          "CODEX_THREAD_NOT_FOUND",
          "No Codex thread was found for the active workspace.",
        );
      }

      let selected = candidates[0];
      if (candidates.length > 1) {
        const picked = await vscode.window.showQuickPick(
          candidates.map((thread) => ({
            label: threadTitle(thread),
            description: updatedDescription(thread),
            thread,
          })),
          {
            title: "Select the Codex thread to hand off to Cursor",
            placeHolder: "Choose a Codex conversation",
          },
        );
        if (!picked) {
          throw new HandoffError(
            "THREAD_SELECTION_CANCELLED",
            "Codex thread selection was cancelled.",
          );
        }
        selected = picked.thread;
      }

      const read = await client.request<ThreadReadResult>("thread/read", {
        threadId: selected.id,
        includeTurns: true,
      });
      if (codexThreadHasActiveTurn(read?.thread)) {
        throw new HandoffError(
          "CODEX_THREAD_BUSY",
          "Codex is still responding in the selected thread. Wait for it to finish, then retry.",
        );
      }
      const conversation = parseCodexThread(
        read?.thread,
        this.limits,
        this.parserOptions,
      );
      if (conversation.messages.length === 0) {
        throw new HandoffError(
          "CONVERSATION_EMPTY",
          "The selected Codex thread contains no visible text to hand off.",
        );
      }
      return conversation;
    } finally {
      client.close();
    }
  }
}
