import { createHash } from "node:crypto";
import path from "node:path";

export interface CursorConversationPointer {
  version: 1;
  conversationId: string;
  transcriptPath: string;
  workspaceRoot: string;
  hookEventName?: string;
  updatedAt: string;
}

function normalizeWindowsDrivePath(workspacePath: string): string | undefined {
  let input = workspacePath.trim();
  if (/^\/[a-zA-Z]:[\\/]/.test(input)) {
    input = input.slice(1);
  }
  const match = /^([a-zA-Z]):(?:\\|\/)?(.*)$/.exec(input.replace(/\//g, "\\"));
  if (!match) {
    return undefined;
  }
  const tail = match[2]
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
  return `${match[1].toLowerCase()}:${tail ? `/${tail}` : ""}`;
}

export function normalizeWorkspacePath(workspacePath: string): string {
  const windowsPath = normalizeWindowsDrivePath(workspacePath);
  if (windowsPath !== undefined) {
    return windowsPath;
  }
  const normalized = path.resolve(workspacePath).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function pointerFileName(workspacePath: string): string {
  const hash = createHash("sha256")
    .update(normalizeWorkspacePath(workspacePath))
    .digest("hex");
  return `${hash}.json`;
}
