import { createHash } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { RepositorySnapshot } from "./types";

const execFileAsync = promisify(execFile);

async function runGit(
  workspacePath: string,
  args: string[],
): Promise<string> {
  const { stdout } = await execFileAsync("git", args, {
    cwd: workspacePath,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 2 * 1024 * 1024,
    windowsHide: true,
  });
  return stdout.trimEnd();
}

async function runGitWithRetry(
  workspacePath: string,
  args: string[],
): Promise<string | undefined> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await runGit(workspacePath, args);
    } catch {
      if (attempt === 0) {
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }
  return undefined;
}

async function hashGitOutput(
  workspacePath: string,
  args: string[],
  maxBytes: number,
): Promise<{ diffHash?: string; diff?: string; diffTruncated: boolean }> {
  if (maxBytes <= 0) {
    return { diffTruncated: true };
  }

  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const child = spawn("git", args, {
      cwd: workspacePath,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let byteLength = 0;
    let truncated = false;
    let settled = false;

    const finish = (callback: () => void): void => {
      if (!settled) {
        settled = true;
        callback();
      }
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error("git diff timed out")));
    }, 15_000);

    child.stdout.on("data", (chunk: Buffer) => {
      hash.update(chunk);
      if (truncated) {
        return;
      }
      byteLength += chunk.length;
      if (byteLength > maxBytes) {
        truncated = true;
        chunks.length = 0;
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (errors.reduce((sum, value) => sum + value.length, 0) < 32_768) {
        errors.push(chunk);
      }
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      finish(() => reject(error));
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      const diffHash = hash.digest("hex");
      if (truncated) {
        finish(() => resolve({ diffHash, diffTruncated: true }));
      } else if (code === 0) {
        finish(() =>
          resolve({
            diffHash,
            diff: Buffer.concat(chunks).toString("utf8").trimEnd() || undefined,
            diffTruncated: false,
          }),
        );
      } else {
        finish(() =>
          reject(
            new Error(
              Buffer.concat(errors).toString("utf8") ||
                `git exited with code ${String(code)}`,
            ),
          ),
        );
      }
    });
  });
}

function parseChangedFiles(status: string): string[] {
  const files = status
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.slice(3))
    .map((file) => {
      const renameSeparator = file.lastIndexOf(" -> ");
      return renameSeparator >= 0
        ? file.slice(renameSeparator + " -> ".length)
        : file;
    });
  return [...new Set(files)];
}

export async function getGitContext(
  workspacePath: string,
  maxDiffBytes: number,
  includeFullDiff = false,
): Promise<RepositorySnapshot> {
  const empty: RepositorySnapshot = {
    changedFiles: [],
    diffTruncated: false,
  };

  try {
    if ((await runGit(workspacePath, ["rev-parse", "--is-inside-work-tree"])) !== "true") {
      return empty;
    }
  } catch {
    return empty;
  }

  const [head, branch, status, diffStat] = await Promise.all([
    runGitWithRetry(workspacePath, ["rev-parse", "HEAD"]),
    runGitWithRetry(workspacePath, ["branch", "--show-current"]),
    runGitWithRetry(workspacePath, ["status", "--porcelain=v1"]),
    runGitWithRetry(workspacePath, ["diff", "--stat", "HEAD", "--no-ext-diff", "--"]),
  ]);

  let diffHash: string | undefined;
  let diff: string | undefined;
  let diffTruncated = false;
  try {
    const result = await hashGitOutput(
      workspacePath,
      ["diff", "HEAD", "--no-ext-diff", "--unified=3", "--"],
      includeFullDiff ? maxDiffBytes : Number.MAX_SAFE_INTEGER,
    );
    diffHash = result.diffHash;
    diffTruncated = result.diffTruncated;
    if (includeFullDiff) {
      diff = result.diff;
    }
  } catch {
    diffTruncated = true;
  }

  return {
    head: head || undefined,
    branch: branch || undefined,
    changedFiles: parseChangedFiles(status ?? ""),
    diffStat: diffStat || undefined,
    diffHash,
    diff,
    diffTruncated,
  };
}
