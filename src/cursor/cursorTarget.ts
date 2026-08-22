import * as vscode from "vscode";
import { HandoffError } from "../handoff/errors";
import { HandoffFileStore } from "../handoff/handoffFileStore";
import type { CursorTarget, HandoffContext } from "../handoff/types";
import { readCursorConversationPointer } from "./conversationSource";
import { ADD_FILES_COMMAND, cursorTransferPolicy } from "./transferPolicy";

const OPEN_COMPOSER_IDS_COMMAND = "composer.getOrderedSelectedComposerIds";
const FOCUS_COMPOSER_COMMAND = "composer.focusComposer";

export class OfficialCursorTarget implements CursorTarget {
  private readonly store: HandoffFileStore;
  private readonly pointerDirectory: string;

  constructor(globalStorageUri: vscode.Uri, keepHandoffCount = 5) {
    this.store = new HandoffFileStore(globalStorageUri.fsPath, keepHandoffCount);
    this.pointerDirectory = vscode.Uri.joinPath(
      globalStorageUri,
      "cursor-pointers",
    ).fsPath;
  }

  async getTargetSessionId(workspacePath: string): Promise<string | undefined> {
    try {
      const commands = await vscode.commands.getCommands(true);
      if (
        !commands.includes(OPEN_COMPOSER_IDS_COMMAND) ||
        !commands.includes(FOCUS_COMPOSER_COMMAND)
      ) {
        return undefined;
      }
      const pointer = await readCursorConversationPointer(
        this.pointerDirectory,
        workspacePath,
      );
      const openIds = await vscode.commands.executeCommand<unknown>(
        OPEN_COMPOSER_IDS_COMMAND,
      );
      return Array.isArray(openIds) &&
        openIds.every((id) => typeof id === "string") &&
        openIds.includes(pointer.conversationId)
        ? pointer.conversationId
        : undefined;
    } catch {
      return undefined;
    }
  }

  async sendHandoff(context: HandoffContext): Promise<boolean> {
    const stored = await this.store.write(context);
    const commands = await vscode.commands.getCommands(true);
    const policy = cursorTransferPolicy(commands);

    if (policy.canAttach) {
      try {
        if (context.metadata.targetSessionId) {
          if (!commands.includes(FOCUS_COMPOSER_COMMAND)) {
            throw new Error("Cursor composer focus command is unavailable.");
          }
          await vscode.commands.executeCommand(
            FOCUS_COMPOSER_COMMAND,
            context.metadata.targetSessionId,
          );
        }
        await vscode.commands.executeCommand(
          ADD_FILES_COMMAND,
          vscode.Uri.file(stored.filePath),
          { useExactResource: true },
        );
        return true;
      } catch {
        // Fall through to the deterministic clipboard handoff.
      }
    }

    try {
      const document = await vscode.workspace.openTextDocument(stored.filePath);
      await vscode.window.showTextDocument(document, { preview: false });
      await vscode.env.clipboard.writeText(
        `Continue from this Codex handoff. Do not repeat completed work unless needed.\n\n${stored.markdown}`,
      );
      await vscode.commands.executeCommand(policy.openChatCommand);
      await vscode.window.showWarningMessage(
        "Cursor could not attach the handoff automatically. The full context is copied; paste it into Cursor Chat and press Enter.",
      );
      return false;
    } catch (error) {
      throw new HandoffError(
        policy.canAttach ? "CURSOR_TRANSFER_FAILED" : "CURSOR_COMMAND_MISSING",
        policy.canAttach
          ? "Cursor could not attach the Codex handoff or prepare the clipboard fallback."
          : "This Cursor version does not expose its attachment command, and the clipboard fallback failed.",
        { cause: error },
      );
    }
  }
}
