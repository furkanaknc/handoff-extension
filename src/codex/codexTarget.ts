import * as vscode from "vscode";
import { HandoffError } from "../handoff/errors";
import { HandoffFileStore } from "../handoff/handoffFileStore";
import type { CodexTarget, HandoffContext } from "../handoff/types";

const CODEX_EXTENSION_ID = "openai.chatgpt";
const ADD_FILE_COMMAND = "chatgpt.addFileToThread";

export class OfficialCodexTarget implements CodexTarget {
  private readonly store: HandoffFileStore;

  constructor(globalStorageUri: vscode.Uri, keepHandoffCount = 5) {
    this.store = new HandoffFileStore(globalStorageUri.fsPath, keepHandoffCount);
  }

  async sendHandoff(context: HandoffContext): Promise<void> {
    const extension = vscode.extensions.getExtension(CODEX_EXTENSION_ID);
    if (!extension) {
      throw new HandoffError(
        "CODEX_NOT_INSTALLED",
        "The official OpenAI Codex extension is not installed in Cursor.",
      );
    }

    await extension.activate();
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes(ADD_FILE_COMMAND)) {
      throw new HandoffError(
        "CODEX_COMMAND_MISSING",
        "The installed Codex extension does not expose Add File to Codex Thread.",
      );
    }

    const { filePath } = await this.store.write(context);

    try {
      await vscode.commands.executeCommand(ADD_FILE_COMMAND, vscode.Uri.file(filePath));
    } catch (error) {
      throw new HandoffError(
        "CODEX_TRANSFER_FAILED",
        "Codex opened, but the handoff file could not be attached to the active thread.",
        { cause: error },
      );
    }
  }
}
