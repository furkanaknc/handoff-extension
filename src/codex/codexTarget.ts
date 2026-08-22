import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import * as vscode from "vscode";
import { HandoffError } from "../handoff/errors";
import { renderHandoffMarkdown } from "../handoff/renderMarkdown";
import type { CodexTarget, HandoffContext } from "../handoff/types";

const CODEX_EXTENSION_ID = "openai.chatgpt";
const ADD_FILE_COMMAND = "chatgpt.addFileToThread";

export class OfficialCodexTarget implements CodexTarget {
  constructor(private readonly globalStorageUri: vscode.Uri) {}

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

    const handoffDirectory = path.join(
      this.globalStorageUri.fsPath,
      "handoffs",
    );
    await fs.mkdir(handoffDirectory, { recursive: true });
    const timestamp = context.metadata.createdAt.replace(/[:.]/g, "-");
    const filePath = path.join(
      handoffDirectory,
      `handoff-${timestamp}-${randomUUID()}.md`,
    );
    await fs.writeFile(filePath, renderHandoffMarkdown(context), {
      encoding: "utf8",
      mode: 0o600,
    });

    try {
      await vscode.commands.executeCommand(ADD_FILE_COMMAND, vscode.Uri.file(filePath));
    } catch (error) {
      throw new HandoffError(
        "CODEX_TRANSFER_FAILED",
        "Codex opened, but the handoff file could not be attached to the active thread.",
        { cause: error },
      );
    }

    await this.cleanupOldHandoffs(handoffDirectory);
  }

  private async cleanupOldHandoffs(directory: string): Promise<void> {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const files = await Promise.all(
        entries
          .filter(
            (entry) =>
              entry.isFile() &&
              entry.name.startsWith("handoff-") &&
              entry.name.endsWith(".md"),
          )
          .map(async (entry) => {
            const filePath = path.join(directory, entry.name);
            return { filePath, stat: await fs.stat(filePath) };
          }),
      );
      files.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
      await Promise.all(
        files.slice(10).map(({ filePath }) => fs.rm(filePath, { force: true })),
      );
    } catch {
      // Cleanup is best-effort and must not turn a successful handoff into a failure.
    }
  }
}
