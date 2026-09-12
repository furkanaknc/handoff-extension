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
  type ThreadTargetCoreDependencies,
} from "./threadTargetCore";

const CODEX_EXTENSION_ID = "openai.chatgpt";
const ATTACH_ACTION = "Attach handoff";

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

function readRoutingTrust(): CodexRoutingTrust {
  const configured = vscode.workspace
    .getConfiguration("handoff")
    .get<string>("codexRoutingTrust", "auto");
  if (configured === "always" || configured === "never") {
    return configured;
  }
  return "auto";
}

const defaultDependencies: ThreadTargetCoreDependencies = {
  resolveInstallation: defaultInstallation,
  createClient: (executablePath) => new CodexAppServerClient(executablePath),
  async pickThread(threads, binding) {
    const picked = await vscode.window.showQuickPick(
      threads.map((thread) => ({
        label: codexThreadTitle(thread),
        description:
          binding?.codexThreadId === thread.id
            ? "$(link) Current binding"
            : updatedDescription(thread),
        detail:
          binding?.codexThreadId === thread.id
            ? updatedDescription(thread)
            : undefined,
        thread,
      })),
      {
        title: "Select the Codex thread for this Cursor handoff",
        placeHolder: "The selected thread will be opened before attachment",
      },
    );
    return picked?.thread;
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
      readRoutingTrust(),
    );
  }

  prepareTargetSession(session: ResolvedTargetSession): Promise<void> {
    return prepareCodexTargetSession(session, this.dependencies);
  }
}
