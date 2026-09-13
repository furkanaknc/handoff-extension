import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import * as vscode from "vscode";
import { HandoffError } from "../handoff/errors";
import {
  hasCurrentHandoffHooks,
  hasOwnedHandoffHooks,
  HOOK_MARKER,
  mergeHandoffHooks,
  removeHandoffHooks,
  type CursorHooksConfig,
} from "./hookConfig";

export type HookInstallResult = "ready" | "installed" | "cancelled";
export type HookIntegrationStatus = "ready" | "repair-needed" | "not-installed";

function quote(value: string): string {
  if (value.includes('"')) {
    throw new Error("Hook paths containing quotes are not supported.");
  }
  return `"${value}"`;
}

function buildHookCommand(
  hookScriptPath: string,
  stateDirectory: string,
): string {
  return `node ${quote(hookScriptPath)} ${HOOK_MARKER} --state-dir ${quote(stateDirectory)}`;
}

function hookLocations(context: vscode.ExtensionContext): {
  cursorDirectory: string;
  configPath: string;
  command: string;
} {
  const cursorDirectory = path.join(os.homedir(), ".cursor");
  const configPath = path.join(cursorDirectory, "hooks.json");
  const stateDirectory = path.join(
    context.globalStorageUri.fsPath,
    "cursor-pointers",
  );
  const hookScriptPath = context.asAbsolutePath(
    path.join("dist", "src", "cursor", "cursorHook.js"),
  );
  return {
    cursorDirectory,
    configPath,
    command: buildHookCommand(hookScriptPath, stateDirectory),
  };
}

async function readConfig(configPath: string): Promise<{
  config: CursorHooksConfig;
  original?: string;
}> {
  try {
    const original = await fs.readFile(configPath, "utf8");
    const parsed: unknown = JSON.parse(original);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Root value must be a JSON object.");
    }
    return { config: parsed as CursorHooksConfig, original };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { config: {} };
    }
    throw new HandoffError(
      "HOOK_CONFIG_INVALID",
      `Cursor hook configuration could not be read safely: ${configPath}`,
      { cause: error },
    );
  }
}

function backupSuffix(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

export async function ensureCursorHookInstalled(
  context: vscode.ExtensionContext,
  now: () => Date = () => new Date(),
): Promise<HookInstallResult> {
  const { cursorDirectory, configPath, command } = hookLocations(context);
  const { config, original } = await readConfig(configPath);
  const isRepair = hasOwnedHandoffHooks(config);

  if (hasCurrentHandoffHooks(config, command)) {
    return "ready";
  }

  if (!isRepair) {
    const choice = await vscode.window.showInformationMessage(
      "Cursor Codex Handoff needs a local Cursor hook to identify the active conversation. It stores only the conversation ID and transcript path.",
      { modal: true },
      "Install Hook",
    );
    if (choice !== "Install Hook") {
      return "cancelled";
    }
  }

  let merged: CursorHooksConfig;
  try {
    merged = mergeHandoffHooks(config, command);
  } catch (error) {
    throw new HandoffError(
      "HOOK_CONFIG_INVALID",
      "The existing Cursor hooks.json uses an unsupported format or version.",
      { cause: error },
    );
  }

  await fs.mkdir(cursorDirectory, { recursive: true });
  if (original !== undefined) {
    const backupPath = `${configPath}.handoff-backup-${backupSuffix(now())}.json`;
    await fs.writeFile(backupPath, original, "utf8");
  }

  const temporaryPath = `${configPath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
  await fs.rename(temporaryPath, configPath);
  return isRepair ? "ready" : "installed";
}

export async function checkCursorHookIntegration(
  context: vscode.ExtensionContext,
): Promise<HookIntegrationStatus> {
  const { configPath, command } = hookLocations(context);
  const { config } = await readConfig(configPath);
  if (hasCurrentHandoffHooks(config, command)) {
    return "ready";
  }
  return hasOwnedHandoffHooks(config) ? "repair-needed" : "not-installed";
}

export async function removeCursorHookIntegration(
  context: vscode.ExtensionContext,
  now: () => Date = () => new Date(),
): Promise<boolean> {
  const { cursorDirectory, configPath } = hookLocations(context);
  const { config, original } = await readConfig(configPath);
  if (!hasOwnedHandoffHooks(config)) {
    return false;
  }
  await fs.mkdir(cursorDirectory, { recursive: true });
  if (original !== undefined) {
    const backupPath = `${configPath}.handoff-backup-${backupSuffix(now())}.json`;
    await fs.writeFile(backupPath, original, "utf8");
  }
  const temporaryPath = `${configPath}.${process.pid}.remove.tmp`;
  await fs.writeFile(
    temporaryPath,
    `${JSON.stringify(removeHandoffHooks(config), null, 2)}\n`,
    "utf8",
  );
  await fs.rename(temporaryPath, configPath);
  return true;
}
