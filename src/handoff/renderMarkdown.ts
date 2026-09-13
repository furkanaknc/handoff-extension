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

function modeLabel(mode: NonNullable<HandoffContext["metadata"]["mode"]>): string {
  switch (mode) {
    case "repository-only":
      return "Repository only";
    case "bootstrap":
      return "Bootstrap";
    case "recovery":
      return "Recovery";
    default:
      return "Delta";
  }
}

export function renderHandoffMarkdown(context: HandoffContext): string {
  const mode = context.metadata.mode ?? "bootstrap";
  const provenance = context.metadata.handoffId
    ? [
        "<!-- cursor-codex-handoff",
        "version: 1",
        `handoff-id: ${context.metadata.handoffId}`,
        `mode: ${mode}`,
        `source: ${context.source}`,
        "-->",
        "",
      ]
    : [];
  const lines: string[] = [
    ...provenance,
    `# Handoff from ${sourceLabel(context.source)}`,
    "",
    `Handoff mode: ${modeLabel(mode)}`,
    "",
    "The target agent has access to the same workspace. Inspect the working tree or run `git diff` if additional implementation detail is needed.",
    "",
    "## Current conversation",
    "",
  ];

  const conversation = context.conversation;
  if (!conversation || conversation.messages.length === 0) {
    lines.push(
      mode === "repository-only"
        ? "No new source conversation messages. Repository state changed since the previous handoff."
        : "No visible conversation messages were captured.",
      "",
    );
  } else {
    if (conversation.truncated) {
      lines.push(
        "> Earlier source conversation omitted from this handoff.",
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

  const repository = context.repository;
  if (repository) {
    lines.push("## Repository state", "");
    const hasRepositoryData =
      repository.head !== undefined ||
      repository.branch !== undefined ||
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
      if (repository.diffTruncated) {
        lines.push(
          repository.diffOmittedReason === "token-budget"
            ? "> Full Git diff omitted because it exceeded the handoff token budget. Inspect the shared working tree directly."
            : "> Full Git diff omitted because it exceeded the configured size limit or could not be read safely.",
          "",
        );
      } else if (repository.diff) {
        const fence = codeFence(repository.diff);
        lines.push("## Git diff", "", `${fence}diff`, repository.diff, fence, "");
      }
    }
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
