import path from "node:path";
import * as vscode from "vscode";
import { OfficialCodexTarget } from "./codex/codexTarget";
import { OfficialCodexConversationSource } from "./codex/conversationSource";
import { CodexThreadTargetResolver } from "./codex/threadTargetResolver";
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
  const diagnostics = vscode.window.createOutputChannel("Handoff Diagnostics");
  let controlCenterButton: vscode.StatusBarItem | undefined;

  const refreshBindingStatus = async (): Promise<void> => {
    if (!controlCenterButton) {
      return;
    }
    const workspaceFolder = activeWorkspaceFolder();
    if (!workspaceFolder) {
      controlCenterButton.text = "$(warning) Handoff";
      controlCenterButton.tooltip = "No active workspace; handoff unavailable";
      return;
    }
    const memory = await syncStateStore.load(workspaceFolder.uri.fsPath);
    const bound = memory.sessionBinding !== undefined;
    controlCenterButton.text = bound ? "$(sync) Handoff" : "$(warning) Handoff";
    controlCenterButton.tooltip = new vscode.MarkdownString(
      [
        `**Session binding:** ${bound ? "verified" : "unverified"}`,
        `**Cursor → Codex:** ${memory.cursorToCodex?.lastMode ?? "never"}`,
        `**Codex → Cursor:** ${memory.codexToCursor?.lastMode ?? "never"}`,
        "Click to open the Handoff control center.",
      ].join("  \n"),
    );
  };
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
        const targetResolver = new CodexThreadTargetResolver();
        const target = new OfficialCodexTarget(
          context.globalStorageUri,
          positiveIntegerSetting("maxStoredHandoffs", 5),
          targetResolver,
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
              resolveTargetSession: (workspacePath, binding) =>
                targetResolver.resolveTargetSession(workspacePath, binding),
            }),
        );
        await showSyncResult("Cursor → Codex", result);
        await refreshBindingStatus();
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
      await refreshBindingStatus();
      await vscode.window.showInformationMessage(
        "Handoff sync state was reset. The next transfer in each direction will be full.",
      );
    },
  );

  const showDiagnostics = vscode.commands.registerCommand(
    "handoff.showSyncDiagnostics",
    async () => {
      const workspaceFolder = activeWorkspaceFolder();
      if (!workspaceFolder) {
        await vscode.window.showErrorMessage(
          "No active workspace is open. Open a folder before showing handoff diagnostics.",
        );
        return;
      }
      const memory = await syncStateStore.load(workspaceFolder.uri.fsPath);
      const binding = memory.sessionBinding;
      diagnostics.clear();
      diagnostics.appendLine("Cursor Codex Handoff diagnostics");
      diagnostics.appendLine(`Workspace: ${workspaceFolder.uri.fsPath}`);
      diagnostics.appendLine(`Memory version: ${memory.version}`);
      diagnostics.appendLine(`Binding: ${binding ? "verified" : "unverified"}`);
      diagnostics.appendLine(
        `Cursor conversation: ${binding?.cursorConversationId ?? "unknown"}`,
      );
      diagnostics.appendLine(`Codex thread: ${binding?.codexThreadId ?? "unknown"}`);
      diagnostics.appendLine(
        `Verification method: ${binding?.verificationMethod ?? "none"}`,
      );
      diagnostics.appendLine(`Verified at: ${binding?.verifiedAt ?? "never"}`);
      for (const [label, state] of [
        ["Cursor → Codex", memory.cursorToCodex],
        ["Codex → Cursor", memory.codexToCursor],
      ] as const) {
        diagnostics.appendLine("");
        diagnostics.appendLine(label);
        diagnostics.appendLine(`  Source session: ${state?.sourceSessionId ?? "unknown"}`);
        diagnostics.appendLine(`  Target session: ${state?.targetSessionId ?? "unknown"}`);
        diagnostics.appendLine(`  Last handoff: ${state?.lastHandoffId ?? "never"}`);
        diagnostics.appendLine(`  Last handoff at: ${state?.lastHandoffAt ?? "never"}`);
        diagnostics.appendLine(`  Last mode: ${state?.lastMode ?? "unknown"}`);
      }
      diagnostics.show(true);
    },
  );

  const openControlCenter = vscode.commands.registerCommand(
    "handoff.openControlCenter",
    async () => {
      const workspaceFolder = activeWorkspaceFolder();
      if (!workspaceFolder) {
        await vscode.window.showErrorMessage(
          "No active workspace is open. Open a folder before using Handoff.",
        );
        return;
      }
      const memory = await syncStateStore.load(workspaceFolder.uri.fsPath);
      const binding = memory.sessionBinding;
      const describeState = (
        state: typeof memory.cursorToCodex,
      ): string =>
        state
          ? `${state.lastMode ?? "unknown"} • ${new Date(state.lastHandoffAt).toLocaleString()}`
          : "Never transferred";
      const picked = await vscode.window.showQuickPick(
        [
          {
            label: binding
              ? "$(verified-filled) Session binding verified"
              : "$(warning) Session binding unverified",
            description: binding?.verificationMethod ?? "Next transfer will be FULL",
            detail: binding
              ? `Cursor ${binding.cursorConversationId} ↔ Codex ${binding.codexThreadId}`
              : "No verified Cursor/Codex pair is stored for this workspace.",
            action: "diagnostics" as const,
          },
          {
            label: "$(arrow-right) Cursor → Codex",
            description: describeState(memory.cursorToCodex),
            detail: "Select and attach the current Cursor conversation to a Codex thread.",
            action: "cursorToCodex" as const,
          },
          {
            label: "$(arrow-left) Codex → Cursor",
            description: describeState(memory.codexToCursor),
            detail: "Attach a Codex conversation to the current Cursor conversation.",
            action: "codexToCursor" as const,
          },
          {
            label: "$(output) Show full sync diagnostics",
            description: "IDs, binding, last modes and timestamps",
            action: "diagnostics" as const,
          },
          {
            label: "$(trash) Reset all handoff state…",
            description: "Delete transfer state and session binding for this workspace",
            detail: "The next transfer in each direction will be FULL.",
            action: "reset" as const,
          },
        ],
        {
          title: "Handoff Control Center",
          placeHolder: "Inspect state or choose an action",
        },
      );
      if (!picked) {
        return;
      }
      const commands = {
        cursorToCodex: "handoff.cursorToCodex",
        codexToCursor: "handoff.codexToCursor",
        diagnostics: "handoff.showSyncDiagnostics",
        reset: "handoff.resetSyncState",
      } as const;
      await vscode.commands.executeCommand(commands[picked.action]);
      await refreshBindingStatus();
    },
  );

  controlCenterButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    101,
  );
  controlCenterButton.name = "Handoff Control Center";
  controlCenterButton.command = "handoff.openControlCenter";
  controlCenterButton.show();
  void refreshBindingStatus();

  context.subscriptions.push(
    cursorToCodex,
    codexToCursor,
    resetSyncState,
    showDiagnostics,
    openControlCenter,
    diagnostics,
    controlCenterButton,
    vscode.window.onDidChangeActiveTextEditor(() => {
      void refreshBindingStatus();
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      void refreshBindingStatus();
    }),
  );
}

export function deactivate(): void {}
