const PROVENANCE_HEADER = "<!-- cursor-codex-handoff\nversion: 1\n";
const CLIPBOARD_PREFIX =
  "Continue from this Codex handoff. Do not repeat completed work unless needed.\n\n";

export function isGeneratedHandoffText(value: string): boolean {
  const normalized = value.replace(/\r\n/g, "\n").trimStart();
  return (
    normalized.startsWith(PROVENANCE_HEADER) ||
    normalized.startsWith(`${CLIPBOARD_PREFIX}${PROVENANCE_HEADER}`)
  );
}

const REDACTED_LINE = /^\s*\[REDACTED\]\s*$/;

function looksLikeUserFacingReply(text: string): boolean {
  if (text.includes("```") || text.includes("##") || text.includes("**")) {
    return true;
  }
  if (text.includes("?")) {
    return true;
  }
  const paragraphs = text.split(/\n\s*\n/).filter((part) => part.trim().length > 0);
  if (paragraphs.length >= 3) {
    return true;
  }
  return text.length > 300;
}

export function stripCursorTransportNoise(
  value: string,
  options?: { accompaniedByToolUse?: boolean },
): string {
  const normalized = value.replace(/\r\n/g, "\n");
  const hadRedacted = normalized.includes("[REDACTED]");

  const cleaned = normalized
    .replace(/\[REDACTED\]/g, "")
    .split("\n")
    .filter((line) => !REDACTED_LINE.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (
    options?.accompaniedByToolUse &&
    hadRedacted &&
    cleaned.length > 0 &&
    !looksLikeUserFacingReply(cleaned)
  ) {
    return "";
  }

  return cleaned;
}

export function sanitizeHandoffMessageContent(
  role: "user" | "assistant",
  content: string,
): string {
  const sanitized =
    role === "assistant"
      ? stripCursorTransportNoise(content)
      : stripGeneratedHandoffReferences(content);
  return sanitized.trim();
}

export function stripGeneratedHandoffReferences(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n");
  const handoffReference =
    /^##[ \t]+(handoff-[^:\n]+\.md):[ \t]+.*[\\/]handoffs[\\/]\1[ \t]*$/gim;
  const withoutReferences = normalized.replace(handoffReference, "");
  if (withoutReferences === normalized) {
    return value.trim();
  }
  return withoutReferences
    .replace(
      /^# Files mentioned by the user:[ \t]*\n(?:[ \t]*\n)*(?=## My request for (?:Codex|Cursor):|$)/gim,
      "",
    )
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
