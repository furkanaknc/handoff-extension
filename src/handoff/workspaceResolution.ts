import path from "node:path";

export interface WorkspaceCandidate {
  path: string;
  hasBinding: boolean;
}

export type WorkspaceResolution =
  | { kind: "selected"; index: number; reason: "only-root" | "binding" | "active-editor" }
  | { kind: "ambiguous" };

function samePath(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const resolved = path.resolve(value).replace(/[\\/]+$/, "");
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  return normalize(left) === normalize(right);
}

export function resolveWorkspaceCandidate(
  candidates: readonly WorkspaceCandidate[],
  activeEditorPath?: string,
): WorkspaceResolution {
  if (candidates.length === 1) {
    return { kind: "selected", index: 0, reason: "only-root" };
  }

  const boundIndexes = candidates.flatMap((candidate, index) =>
    candidate.hasBinding ? [index] : [],
  );
  if (boundIndexes.length === 1) {
    return { kind: "selected", index: boundIndexes[0], reason: "binding" };
  }
  if (boundIndexes.length > 1) {
    return { kind: "ambiguous" };
  }

  if (activeEditorPath) {
    const activeIndex = candidates.findIndex((candidate) =>
      samePath(candidate.path, activeEditorPath),
    );
    if (activeIndex >= 0) {
      return { kind: "selected", index: activeIndex, reason: "active-editor" };
    }
  }
  return { kind: "ambiguous" };
}
