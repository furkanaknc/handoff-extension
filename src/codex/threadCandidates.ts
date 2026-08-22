import { normalizeWorkspacePath } from "../cursor/pointer";

export interface CodexThreadSummary {
  id?: unknown;
  name?: unknown;
  preview?: unknown;
  cwd?: unknown;
  source?: unknown;
  updatedAt?: unknown;
}

export type SelectableCodexThread = CodexThreadSummary & { id: string };

export function matchingCodexThreads(
  values: unknown,
  workspacePath: string,
): SelectableCodexThread[] {
  const normalizedWorkspace = normalizeWorkspacePath(workspacePath);
  return (Array.isArray(values) ? values : []).filter(
    (value): value is SelectableCodexThread => {
      if (
        value === null ||
        typeof value !== "object" ||
        typeof (value as CodexThreadSummary).id !== "string"
      ) {
        return false;
      }
      const thread = value as CodexThreadSummary;
      return (
        (thread.source === undefined || thread.source === "vscode") &&
        (typeof thread.cwd !== "string" ||
          normalizeWorkspacePath(thread.cwd) === normalizedWorkspace)
      );
    },
  );
}
