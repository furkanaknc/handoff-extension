import path from "node:path";
import * as vscode from "vscode";
import { OfficialCodexTarget } from "./codex/codexTarget";
import { HookCursorConversationSource } from "./cursor/conversationSource";
import { ensureCursorHookInstalled } from "./cursor/hookInstaller";
import { HandoffError } from "./handoff/errors";
import { getGitContext } from "./handoff/gitContext";
import { performCursorToCodexHandoff } from "./handoff/orchestrator";

function activeWorkspaceFolder(): vscode.WorkspaceFolder | undefined {
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const activeFolder = vscode.workspace.getWorkspaceFolder(activeUri);
    if (activeFolder) {
      return activeFolder;
    }
  }
  return vscode.workspace.workspaceFolders?.[0];
}

function positiveIntegerSetting(name: string, fallback: number): number {
  const configured = vscode.workspace
    .getConfiguration("handoff")
    .get<number>(name, fallback);
  return Number.isFinite(configured) && configured > 0
    ? Math.floor(configured)
    : fallback;
}

function nonNegativeIntegerSetting(name: string, fallback: number): number {
  const configured = vscode.workspace
    .getConfiguration("handoff")
    .get<number>(name, fallback);
  return Number.isFinite(configured) && configured >= 0
    ? Math.floor(configured)
    : fallback;
}

function userFacingError(error: unknown): string {
  if (error instanceof HandoffError) {
    return error.message;
  }
  return "Cursor to Codex handoff failed. Check the Extension Host log for the error type and retry.";
}

export function activate(context: vscode.ExtensionContext): void {
  const disposable = vscode.commands.registerCommand(
    "handoff.cursorToCodex",
    async () => {
      const workspaceFolder = activeWorkspaceFolder();
      if (!workspaceFolder) {
        await vscode.window.showErrorMessage(
          "No active workspace is open. Open a folder before handing off to Codex.",
        );
        return;
      }

      try {
        const hookResult = await ensureCursorHookInstalled(context);
        if (hookResult === "cancelled") {
          return;
        }
        if (hookResult === "installed") {
          await vscode.window.showInformationMessage(
            "Cursor hook installed. Send one message in Cursor Chat, then run Handoff: Cursor → Codex again.",
          );
          return;
        }

        const stateDirectory = path.join(
          context.globalStorageUri.fsPath,
          "cursor-pointers",
        );
        const source = new HookCursorConversationSource(stateDirectory, {
          maxMessages: positiveIntegerSetting("maxConversationMessages", 200),
          maxCharacters: positiveIntegerSetting(
            "maxConversationCharacters",
            200_000,
          ),
        });
        const target = new OfficialCodexTarget(context.globalStorageUri);
        const maxDiffBytes = nonNegativeIntegerSetting(
          "maxDiffBytes",
          100 * 1024,
        );

        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Preparing Cursor → Codex handoff",
            cancellable: false,
          },
          () =>
            performCursorToCodexHandoff(
              workspaceFolder.uri.fsPath,
              source,
              target,
              (workspacePath) => getGitContext(workspacePath, maxDiffBytes),
            ),
        );

        await vscode.window.showInformationMessage(
          "Cursor context was attached to the active Codex thread.",
        );
      } catch (error) {
        console.error("Cursor Codex Handoff failed", {
          errorName: error instanceof Error ? error.name : typeof error,
          errorCode: error instanceof HandoffError ? error.code : undefined,
        });
        await vscode.window.showErrorMessage(userFacingError(error));
      }
    },
  );

  context.subscriptions.push(disposable);
}

export function deactivate(): void {}
