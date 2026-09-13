import * as vscode from "vscode";
import type {
  ResolvedTargetSession,
  SessionBinding,
} from "../handoff/types";
import { resolveCodexExecutable } from "./codexInstallation";
import { CodexAppServerClient } from "./appServerClient";
import type { SelectableCodexThread } from "./threadCandidates";
import {
  codexThreadRoute,
  codexThreadTitle,
  prepareCodexTargetSession,
  resolveCodexTargetSession,
  type CodexInstallation,
  type CodexRoutingTrust,
  type CodexTargetPreference,
  type ThreadPickResult,
  type ThreadTargetCoreDependencies,
} from "./threadTargetCore";

const CODEX_EXTENSION_ID = "openai.chatgpt";
const NEW_CHAT_COMMAND = "chatgpt.newChat";
const OPEN_SIDEBAR_COMMAND = "chatgpt.openSidebar";
const ATTACH_ACTION = "Attach handoff";
const HANDOFF_EXTENSION_ID = "handoff-ext.cursor-codex-handoff";

function updatedDescription(thread: SelectableCodexThread): string | undefined {
  return typeof thread.updatedAt === "number"
    ? `Updated ${new Date(thread.updatedAt * 1000).toLocaleString()}`
    : undefined;
}

async function defaultInstallation(): Promise<CodexInstallation | undefined> {
  const extension = vscode.extensions.getExtension(CODEX_EXTENSION_ID);
  if (!extension) {
    return undefined;
  }
  await extension.activate();
  const executablePath = await resolveCodexExecutable(extension.extensionPath);
  if (!executablePath) {
    return undefined;
  }
  return { version: extension.packageJSON.version as string, executablePath };
}

function handoffExtensionVersion(): string {
  const extension = vscode.extensions.getExtension(HANDOFF_EXTENSION_ID);
  return (extension?.packageJSON.version as string | undefined) ?? "0.1.1";
}

function readRoutingTrust(): CodexRoutingTrust {
  const configured = vscode.workspace
    .getConfiguration("handoff")
    .get<string>("codexRoutingTrust", "auto");
  if (configured === "always" || configured === "never") {
    return configured;
  }
  return "auto";
}

function readCodexTargetPreference(): CodexTargetPreference {
  const configured = vscode.workspace
    .getConfiguration("handoff")
    .get<string>("codexTarget", "bound");
  if (
    configured === "bound" ||
    configured === "new" ||
    configured === "active" ||
    configured === "ask"
  ) {
    return configured;
  }
  return "bound";
}

function readSkipAttachmentConfirmation(): boolean {
  return vscode.workspace
    .getConfiguration("handoff")
    .get<boolean>("skipAttachmentConfirmation", false);
}

const defaultDependencies: ThreadTargetCoreDependencies = {
  resolveInstallation: defaultInstallation,
  createClient: (executablePath) =>
    new CodexAppServerClient(
      executablePath,
      ["app-server"],
      15_000,
      handoffExtensionVersion(),
    ),
  async pickThread(threads, binding) {
    type ThreadPickItem = vscode.QuickPickItem & {
      pick: ThreadPickResult;
    };
    const picked = await vscode.window.showQuickPick<ThreadPickItem>(
      [
        {
          label: "$(add) Start new Codex chat",
          description: "Open a fresh thread for this bootstrap handoff",
          pick: { kind: "new" },
        },
        ...threads.map((thread) => ({
          label: codexThreadTitle(thread),
          description:
            binding?.codexThreadId === thread.id
              ? "$(link) Current binding"
              : updatedDescription(thread),
          detail:
            binding?.codexThreadId === thread.id
              ? updatedDescription(thread)
              : undefined,
          pick: { kind: "existing" as const, thread },
        })),
      ],
      {
        title: "Select the Codex thread for this Cursor handoff",
        placeHolder: "Choose a new chat or an existing thread",
      },
    );
    return picked?.pick;
  },
  async openNewChat() {
    const extension = vscode.extensions.getExtension(CODEX_EXTENSION_ID);
    if (extension) {
      await extension.activate();
    }
    const commands = await vscode.commands.getCommands(true);
    if (commands.includes(NEW_CHAT_COMMAND)) {
      await vscode.commands.executeCommand(NEW_CHAT_COMMAND);
      return;
    }
    if (commands.includes(OPEN_SIDEBAR_COMMAND)) {
      await vscode.commands.executeCommand(OPEN_SIDEBAR_COMMAND);
    }
  },
  async openThread(threadId) {
    return vscode.env.openExternal(
      vscode.Uri.parse(codexThreadRoute(vscode.env.uriScheme, threadId)),
    );
  },
  async confirmAttachment(label) {
    const choice = await vscode.window.showInformationMessage(
      `Codex target opened: ${label}. Verify the visible thread, then attach the handoff.`,
      ATTACH_ACTION,
      "Cancel",
    );
    return choice === ATTACH_ACTION;
  },
  async warn(message) {
    await vscode.window.showWarningMessage(message);
  },
};

export class CodexThreadTargetResolver {
  constructor(
    private readonly dependencies: ThreadTargetCoreDependencies =
      defaultDependencies,
  ) {}

  resolveTargetSession(
    workspacePath: string,
    binding?: SessionBinding,
  ): Promise<ResolvedTargetSession | undefined> {
    return resolveCodexTargetSession(
      workspacePath,
      binding,
      this.dependencies,
      {
        routingTrust: readRoutingTrust(),
        preference: readCodexTargetPreference(),
      },
    );
  }

  prepareTargetSession(session: ResolvedTargetSession): Promise<void> {
    return prepareCodexTargetSession(
      session,
      this.dependencies,
      readSkipAttachmentConfirmation(),
    );
  }
}
