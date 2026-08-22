import * as vscode from "vscode";
import { HandoffError } from "../handoff/errors";
import { HandoffFileStore } from "../handoff/handoffFileStore";
import type { CursorTarget, HandoffContext } from "../handoff/types";
import { ADD_FILES_COMMAND, cursorTransferPolicy } from "./transferPolicy";

export class OfficialCursorTarget implements CursorTarget {
  private readonly store: HandoffFileStore;

  constructor(globalStorageUri: vscode.Uri) {
    this.store = new HandoffFileStore(globalStorageUri.fsPath);
  }

  async sendHandoff(context: HandoffContext): Promise<void> {
    const stored = await this.store.write(context);
    const commands = await vscode.commands.getCommands(true);
    const policy = cursorTransferPolicy(commands);

    if (policy.canAttach) {
      try {
        await vscode.commands.executeCommand(
          ADD_FILES_COMMAND,
          vscode.Uri.file(stored.filePath),
          { useExactResource: true },
        );
        return;
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
