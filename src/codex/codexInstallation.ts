import { promises as fs } from "node:fs";
import path from "node:path";

const EXECUTABLE_NAMES = new Set(["codex", "codex.exe"]);

function platformDirectoryName(): string {
  switch (process.platform) {
    case "win32":
      return "windows-x86_64";
    case "darwin":
      return process.arch === "arm64" ? "macos-aarch64" : "macos-x86_64";
    default:
      return process.arch === "arm64" ? "linux-aarch64" : "linux-x86_64";
  }
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

async function findInDirectory(directory: string): Promise<string | undefined> {
  for (const name of EXECUTABLE_NAMES) {
    const candidate = path.join(directory, name);
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

export async function resolveCodexExecutable(
  extensionPath: string,
): Promise<string | undefined> {
  const binRoot = path.join(extensionPath, "bin");
  const preferred = await findInDirectory(
    path.join(binRoot, platformDirectoryName()),
  );
  if (preferred) {
    return preferred;
  }

  let entries: string[];
  try {
    entries = await fs.readdir(binRoot);
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    const candidate = await findInDirectory(path.join(binRoot, entry));
    if (candidate) {
      return candidate;
    }
  }
  return undefined;
}
