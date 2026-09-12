import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SourceCheckpoint } from "./sourceCursor";
import type {
  DirectionSyncState,
  HandoffDirection,
  HandoffManifest,
  HandoffMode,
  SessionBinding,
  WorkspaceMemory,
} from "./types";

const MAX_RECENT_MANIFESTS = 10;

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

function normalizeHandoffMode(value: unknown): HandoffMode | undefined {
  if (value === "full") {
    return "bootstrap";
  }
  if (
    value === "bootstrap" ||
    value === "delta" ||
    value === "repository-only" ||
    value === "recovery"
  ) {
    return value;
  }
  return undefined;
}

function isSourceCheckpoint(value: unknown): value is SourceCheckpoint {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const checkpoint = value as Partial<SourceCheckpoint>;
  return (
    Array.isArray(checkpoint.anchorHashes) &&
    checkpoint.anchorHashes.every((entry) => typeof entry === "string") &&
    typeof checkpoint.lastMessageLength === "number" &&
    Number.isInteger(checkpoint.lastMessageLength) &&
    checkpoint.lastMessageLength >= 0 &&
    (checkpoint.rawOffset === undefined ||
      (typeof checkpoint.rawOffset === "number" &&
        Number.isInteger(checkpoint.rawOffset) &&
        checkpoint.rawOffset >= 0)) &&
    (checkpoint.lastTurnId === undefined ||
      typeof checkpoint.lastTurnId === "string")
  );
}

function isDirectionState(value: unknown): value is DirectionSyncState {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const state = value as Partial<DirectionSyncState>;
  const hasLegacyCheckpoint =
    typeof state.transferredMessageCount === "number" &&
    Number.isInteger(state.transferredMessageCount) &&
    state.transferredMessageCount >= 0 &&
    typeof state.transferredPrefixHash === "string";
  const hasCheckpoint =
    state.sourceCheckpoint === undefined ||
    isSourceCheckpoint(state.sourceCheckpoint);
  return (
    typeof state.sourceSessionId === "string" &&
    typeof state.repositoryFingerprint === "string" &&
    typeof state.lastHandoffId === "string" &&
    typeof state.lastHandoffAt === "string" &&
    (state.lastMode === undefined ||
      normalizeHandoffMode(state.lastMode) !== undefined) &&
    (state.targetSessionId === undefined ||
      typeof state.targetSessionId === "string") &&
    hasCheckpoint &&
    (state.sourceCheckpoint !== undefined ||
      hasLegacyCheckpoint ||
      (state.transferredMessageCount === undefined &&
        state.transferredPrefixHash === undefined))
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

function normalizeDirectionState(value: unknown): DirectionSyncState | undefined {
  if (!isDirectionState(value)) {
    return undefined;
  }
  const state = value as DirectionSyncState;
  const normalizedMode = normalizeHandoffMode(state.lastMode);
  return {
    ...state,
    ...(normalizedMode !== undefined ? { lastMode: normalizedMode } : {}),
  };
}

function validDirections(memory: {
  cursorToCodex?: unknown;
  codexToCursor?: unknown;
}): boolean {
  return (
    (memory.cursorToCodex === undefined ||
      normalizeDirectionState(memory.cursorToCodex) !== undefined) &&
    (memory.codexToCursor === undefined ||
      normalizeDirectionState(memory.codexToCursor) !== undefined)
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

    const migrated: WorkspaceMemory = {
      version: 3,
      sessionBinding:
        memory.sessionBinding === undefined
          ? undefined
          : isSessionBinding(memory.sessionBinding)
            ? memory.sessionBinding
            : undefined,
      cursorToCodex: normalizeDirectionState(memory.cursorToCodex),
      codexToCursor: normalizeDirectionState(memory.codexToCursor),
      recentManifests: Array.isArray(memory.recentManifests)
        ? (memory.recentManifests as HandoffManifest[])
        : undefined,
    };

    if (memory.version === 1 || memory.version === 2) {
      return migrated;
    }
    if (memory.version !== 3) {
      return undefined;
    }
    if (
      memory.sessionBinding !== undefined &&
      !isSessionBinding(memory.sessionBinding)
    ) {
      return undefined;
    }
    return migrated;
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
      return { version: 3 };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 3 };
      }
      this.onInvalidState();
      return { version: 3 };
    }
  }

  async commitSuccessfulTransfer(
    workspacePath: string,
    direction: HandoffDirection,
    state: DirectionSyncState,
    sessionBinding?: SessionBinding | null,
    manifest?: HandoffManifest,
  ): Promise<void> {
    const memory = await this.load(workspacePath);
    memory[direction] = state;
    if (sessionBinding === null) {
      delete memory.sessionBinding;
    } else if (sessionBinding) {
      memory.sessionBinding = sessionBinding;
    }
    if (manifest) {
      memory.recentManifests = [manifest, ...(memory.recentManifests ?? [])].slice(
        0,
        MAX_RECENT_MANIFESTS,
      );
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
