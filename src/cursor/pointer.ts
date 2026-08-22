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

export function normalizeWorkspacePath(workspacePath: string): string {
  const platformPath =
    process.platform === "win32" && /^\/[a-zA-Z]:[\\/]/.test(workspacePath)
      ? workspacePath.slice(1)
      : workspacePath;
  const normalized = path.resolve(platformPath);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function pointerFileName(workspacePath: string): string {
  const hash = createHash("sha256")
    .update(normalizeWorkspacePath(workspacePath))
    .digest("hex");
  return `${hash}.json`;
}
