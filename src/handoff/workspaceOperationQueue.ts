import path from "node:path";

function workspaceKey(workspacePath: string): string {
  const resolved = path.resolve(workspacePath).replace(/[\\/]+$/, "");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export class WorkspaceOperationQueue {
  private readonly tails = new Map<string, Promise<void>>();

  async runExclusive<T>(
    workspacePath: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const key = workspaceKey(workspacePath);
    const previous = this.tails.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(operation);
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);

    try {
      return await run;
    } finally {
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    }
  }
}

export const handoffWorkspaceOperations = new WorkspaceOperationQueue();
