import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type {
  DirectionSyncState,
  HandoffDirection,
  SessionBinding,
  WorkspaceMemory,
} from "./types";

function normalizeWorkspacePath(workspacePath: string): string {
  const resolved = path.resolve(workspacePath).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function memoryFileName(workspacePath: string): string {
  return `${hashWorkspacePath(workspacePath)}.json`;
}

export function hashWorkspacePath(workspacePath: string): string {
  return createHash("sha256")
    .update(normalizeWorkspacePath(workspacePath), "utf8")
    .digest("hex");
}

function isDirectionState(value: unknown): value is DirectionSyncState {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const state = value as Partial<DirectionSyncState>;
  return (
    typeof state.sourceSessionId === "string" &&
    typeof state.transferredMessageCount === "number" &&
    Number.isInteger(state.transferredMessageCount) &&
    state.transferredMessageCount >= 0 &&
    typeof state.transferredPrefixHash === "string" &&
    typeof state.repositoryFingerprint === "string" &&
    typeof state.lastHandoffId === "string" &&
    typeof state.lastHandoffAt === "string" &&
    (state.lastMode === undefined ||
      state.lastMode === "full" ||
      state.lastMode === "delta" ||
      state.lastMode === "repository-only") &&
    (state.targetSessionId === undefined ||
      typeof state.targetSessionId === "string")
  );
}

function isSessionBinding(value: unknown): value is SessionBinding {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const binding = value as Partial<SessionBinding>;
  return (
    typeof binding.cursorConversationId === "string" &&
    binding.cursorConversationId.length > 0 &&
    typeof binding.codexThreadId === "string" &&
    binding.codexThreadId.length > 0 &&
    typeof binding.workspaceHash === "string" &&
    binding.workspaceHash.length > 0 &&
    typeof binding.createdAt === "string" &&
    typeof binding.verifiedAt === "string" &&
    (binding.verificationMethod === "active-state" ||
      binding.verificationMethod === "explicit-selection" ||
      binding.verificationMethod === "post-attachment" ||
      binding.verificationMethod === "other")
  );
}

function validDirections(memory: {
  cursorToCodex?: unknown;
  codexToCursor?: unknown;
}): boolean {
  return (
    (memory.cursorToCodex === undefined ||
      isDirectionState(memory.cursorToCodex)) &&
    (memory.codexToCursor === undefined ||
      isDirectionState(memory.codexToCursor))
  );
}

function parseMemory(raw: string): WorkspaceMemory | undefined {
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object") {
      return undefined;
    }
    const memory = value as Record<string, unknown>;
    if (!validDirections(memory)) {
      return undefined;
    }
    if (memory.version === 1) {
      const migrated: WorkspaceMemory = { version: 2 };
      if (memory.cursorToCodex !== undefined) {
        migrated.cursorToCodex = memory.cursorToCodex as DirectionSyncState;
      }
      if (memory.codexToCursor !== undefined) {
        migrated.codexToCursor = memory.codexToCursor as DirectionSyncState;
      }
      return migrated;
    }
    if (
      memory.version !== 2 ||
      (memory.sessionBinding !== undefined &&
        !isSessionBinding(memory.sessionBinding))
    ) {
      return undefined;
    }
    return memory as unknown as WorkspaceMemory;
  } catch {
    return undefined;
  }
}

export class FileSyncStateStore {
  constructor(
    private readonly globalStoragePath: string,
    private readonly onInvalidState: () => void = () => undefined,
  ) {}

  async load(workspacePath: string): Promise<WorkspaceMemory> {
    try {
      const raw = await fs.readFile(this.filePath(workspacePath), "utf8");
      const parsed = parseMemory(raw);
      if (parsed) {
        return parsed;
      }
      this.onInvalidState();
      return { version: 2 };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 2 };
      }
      this.onInvalidState();
      return { version: 2 };
    }
  }

  async commitSuccessfulTransfer(
    workspacePath: string,
    direction: HandoffDirection,
    state: DirectionSyncState,
    sessionBinding?: SessionBinding,
  ): Promise<void> {
    const memory = await this.load(workspacePath);
    memory[direction] = state;
    if (sessionBinding) {
      memory.sessionBinding = sessionBinding;
    }
    await this.atomicWrite(workspacePath, memory);
  }

  async reset(workspacePath: string): Promise<void> {
    await fs.rm(this.filePath(workspacePath), { force: true });
  }

  pathForTesting(workspacePath: string): string {
    return this.filePath(workspacePath);
  }

  private filePath(workspacePath: string): string {
    return path.join(
      this.globalStoragePath,
      "memory",
      memoryFileName(workspacePath),
    );
  }

  private async atomicWrite(
    workspacePath: string,
    memory: WorkspaceMemory,
  ): Promise<void> {
    const filePath = this.filePath(workspacePath);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(memory, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      await fs.rename(temporaryPath, filePath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true });
      throw error;
    }
  }
}
