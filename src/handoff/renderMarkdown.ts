import type { HandoffContext } from "./types";

function codeFence(content: string): string {
  const runs = content.match(/`+/g) ?? [];
  const longest = runs.reduce((max, run) => Math.max(max, run.length), 0);
  return "`".repeat(Math.max(3, longest + 1));
}

function sourceLabel(source: HandoffContext["source"]): "Cursor" | "Codex" {
  return source === "cursor" ? "Cursor" : "Codex";
}

function labelForRole(
  role: "user" | "assistant",
  source: HandoffContext["source"],
): string {
  return role === "user" ? "User" : sourceLabel(source);
}

export function renderHandoffMarkdown(context: HandoffContext): string {
  const lines: string[] = [
    `# Handoff from ${sourceLabel(context.source)}`,
    "",
    `Workspace: \`${context.workspacePath}\``,
    `Created: ${context.metadata.createdAt}`,
    "",
    "## Current conversation",
    "",
  ];

  const conversation = context.conversation;
  if (!conversation || conversation.messages.length === 0) {
    lines.push("No visible conversation messages were captured.", "");
  } else {
    if (conversation.id) {
      lines.push(`Conversation ID: \`${conversation.id}\``, "");
    }
    if (conversation.truncated) {
      lines.push(
        "> Earlier conversation content was omitted because the configured handoff limit was reached.",
        "",
      );
    }
    for (const message of conversation.messages) {
      lines.push(
        `### ${labelForRole(message.role, context.source)}`,
        "",
        message.content,
        "",
      );
    }
  }

  lines.push("## Repository state", "");
  const repository = context.repository;
  const hasRepositoryData =
    repository.head !== undefined ||
    repository.branch !== undefined ||
    repository.changedFiles.length > 0 ||
    repository.diffStat !== undefined ||
    repository.diff !== undefined;

  if (!hasRepositoryData) {
    lines.push("Git repository not detected or repository state unavailable.", "");
  } else {
    if (repository.branch) {
      lines.push(`Branch: \`${repository.branch}\``, "");
    }
    if (repository.head) {
      lines.push(`HEAD: \`${repository.head}\``, "");
    }
    lines.push("### Changed files", "");
    if (repository.changedFiles.length === 0) {
      lines.push("No changed files.", "");
    } else {
      lines.push(...repository.changedFiles.map((file) => `- ${file}`), "");
    }
    if (repository.diffStat) {
      const fence = codeFence(repository.diffStat);
      lines.push("### Diff stat", "", `${fence}text`, repository.diffStat, fence, "");
    }
    if (repository.diffTruncated) {
      lines.push(
        "> Full Git diff omitted because it exceeded the configured size limit or could not be read safely.",
        "",
      );
    } else if (repository.diff) {
      const fence = codeFence(repository.diff);
      lines.push("## Git diff", "", `${fence}diff`, repository.diff, fence, "");
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
