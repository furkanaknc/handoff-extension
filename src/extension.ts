import path from "node:path";
import * as vscode from "vscode";
import { OfficialCodexTarget } from "./codex/codexTarget";
import { OfficialCodexConversationSource } from "./codex/conversationSource";
import { HookCursorConversationSource } from "./cursor/conversationSource";
import { OfficialCursorTarget } from "./cursor/cursorTarget";
import { ensureCursorHookInstalled } from "./cursor/hookInstaller";
import { HandoffError } from "./handoff/errors";
import { getGitContext } from "./handoff/gitContext";
import {
  performSynchronizedHandoff,
  type SynchronizedHandoffResult,
} from "./handoff/orchestrator";
import { FileSyncStateStore } from "./handoff/syncStateStore";

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

async function showSyncResult(
  direction: "Cursor → Codex" | "Codex → Cursor",
  result: SynchronizedHandoffResult,
): Promise<void> {
  if (result.status === "manual-transfer") {
    return;
  }
  if (result.status === "already-synchronized") {
    await vscode.window.showInformationMessage(
      `${direction}: target already has the current source context.`,
    );
    return;
  }
  const mode = result.context.metadata.mode;
  const detail =
    mode === "repository-only"
      ? "repository changes handed off"
      : mode === "delta"
        ? `${result.messageCount} new message${result.messageCount === 1 ? "" : "s"} handed off`
        : "full context synchronized";
  await vscode.window.showInformationMessage(`${direction}: ${detail}.`);
}

export function activate(context: vscode.ExtensionContext): void {
  const syncStateStore = new FileSyncStateStore(
    context.globalStorageUri.fsPath,
    () => {
      void vscode.window.showWarningMessage(
        "Handoff sync state was unreadable. A safe full handoff will be used.",
      );
    },
  );
  const cursorToCodex = vscode.commands.registerCommand(
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
        const target = new OfficialCodexTarget(
          context.globalStorageUri,
          positiveIntegerSetting("maxStoredHandoffs", 5),
        );
        const maxDiffBytes = nonNegativeIntegerSetting(
          "maxDiffBytes",
          100 * 1024,
        );

        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Preparing Cursor → Codex handoff",
            cancellable: false,
          },
          () =>
            performSynchronizedHandoff({
              workspacePath: workspaceFolder.uri.fsPath,
              direction: "cursorToCodex",
              sourceKind: "cursor",
              source,
              target,
              getRepositoryContext: (workspacePath) =>
                getGitContext(workspacePath, maxDiffBytes),
              syncStateStore,
            }),
        );
        await showSyncResult("Cursor → Codex", result);
      } catch (error) {
        console.error("Cursor Codex Handoff failed", {
          errorName: error instanceof Error ? error.name : typeof error,
          errorCode: error instanceof HandoffError ? error.code : undefined,
        });
        await vscode.window.showErrorMessage(userFacingError(error));
      }
    },
  );

  const codexToCursor = vscode.commands.registerCommand(
    "handoff.codexToCursor",
    async () => {
      const workspaceFolder = activeWorkspaceFolder();
      if (!workspaceFolder) {
        await vscode.window.showErrorMessage(
          "No active workspace is open. Open a folder before handing off to Cursor.",
        );
        return;
      }

      try {
        const source = new OfficialCodexConversationSource({
          maxMessages: positiveIntegerSetting("maxConversationMessages", 200),
          maxCharacters: positiveIntegerSetting(
            "maxConversationCharacters",
            200_000,
          ),
        });
        const target = new OfficialCursorTarget(
          context.globalStorageUri,
          positiveIntegerSetting("maxStoredHandoffs", 5),
        );
        const maxDiffBytes = nonNegativeIntegerSetting(
          "maxDiffBytes",
          100 * 1024,
        );

        const result = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Preparing Codex → Cursor handoff",
            cancellable: false,
          },
          () =>
            performSynchronizedHandoff({
              workspacePath: workspaceFolder.uri.fsPath,
              direction: "codexToCursor",
              sourceKind: "codex",
              source,
              target,
              getRepositoryContext: (workspacePath) =>
                getGitContext(workspacePath, maxDiffBytes),
              syncStateStore,
              getTargetSessionId: (workspacePath) =>
                target.getTargetSessionId(workspacePath),
            }),
        );
        await showSyncResult("Codex → Cursor", result);
      } catch (error) {
        console.error("Codex Cursor Handoff failed", {
          errorName: error instanceof Error ? error.name : typeof error,
          errorCode: error instanceof HandoffError ? error.code : undefined,
        });
        await vscode.window.showErrorMessage(userFacingError(error));
      }
    },
  );

  const resetSyncState = vscode.commands.registerCommand(
    "handoff.resetSyncState",
    async () => {
      const workspaceFolder = activeWorkspaceFolder();
      if (!workspaceFolder) {
        await vscode.window.showErrorMessage(
          "No active workspace is open. Open a folder before resetting handoff sync state.",
        );
        return;
      }
      const confirmation = await vscode.window.showWarningMessage(
        "Reset handoff sync state for this workspace? Cursor conversations, Codex threads, and repository files will not be deleted.",
        { modal: true },
        "Reset",
      );
      if (confirmation !== "Reset") {
        return;
      }
      await syncStateStore.reset(workspaceFolder.uri.fsPath);
      await vscode.window.showInformationMessage(
        "Handoff sync state was reset. The next transfer in each direction will be full.",
      );
    },
  );

  const cursorToCodexButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    101,
  );
  cursorToCodexButton.name = "Handoff: Cursor → Codex";
  cursorToCodexButton.text = "$(arrow-right) Cursor → Codex";
  cursorToCodexButton.tooltip =
    "Attach the current Cursor conversation and repository context to Codex";
  cursorToCodexButton.command = "handoff.cursorToCodex";
  cursorToCodexButton.show();

  const codexToCursorButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100,
  );
  codexToCursorButton.name = "Handoff: Codex → Cursor";
  codexToCursorButton.text = "$(arrow-left) Codex → Cursor";
  codexToCursorButton.tooltip =
    "Attach the current Codex conversation and repository context to Cursor";
  codexToCursorButton.command = "handoff.codexToCursor";
  codexToCursorButton.show();

  context.subscriptions.push(
    cursorToCodex,
    codexToCursor,
    resetSyncState,
    cursorToCodexButton,
    codexToCursorButton,
  );
}

export function deactivate(): void {}
