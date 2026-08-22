import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { renderHandoffMarkdown } from "./renderMarkdown";
import type { HandoffContext } from "./types";

export interface StoredHandoff {
  filePath: string;
  markdown: string;
}

export class HandoffFileStore {
  constructor(
    private readonly globalStoragePath: string,
    private readonly keepCount = 10,
  ) {}

  async write(context: HandoffContext): Promise<StoredHandoff> {
    const directory = path.join(this.globalStoragePath, "handoffs");
    await fs.mkdir(directory, { recursive: true });
    const timestamp = context.metadata.createdAt.replace(/[:.]/g, "-");
    const filePath = path.join(
      directory,
      `handoff-${timestamp}-${randomUUID()}.md`,
    );
    const markdown = renderHandoffMarkdown(context);
    await fs.writeFile(filePath, markdown, { encoding: "utf8", mode: 0o600 });
    await this.cleanup(directory);
    return { filePath, markdown };
  }

  private async cleanup(directory: string): Promise<void> {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });
      const files = await Promise.all(
        entries
          .filter(
            (entry) =>
              entry.isFile() &&
              entry.name.startsWith("handoff-") &&
              entry.name.endsWith(".md"),
          )
          .map(async (entry) => {
            const filePath = path.join(directory, entry.name);
            return { filePath, stat: await fs.stat(filePath) };
          }),
      );
      files.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
      await Promise.all(
        files
          .slice(this.keepCount)
          .map(({ filePath }) => fs.rm(filePath, { force: true })),
      );
    } catch {
      // Cleanup is best-effort and never invalidates a successful handoff.
    }
  }
}
