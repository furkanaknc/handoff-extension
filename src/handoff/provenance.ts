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

export function stripGeneratedHandoffReferences(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n");
  const handoffReference =
    /^##[ \t]+(handoff-[^:\n]+\.md):[ \t]+.*[\\/]local\.cursor-codex-handoff[\\/]handoffs[\\/]\1[ \t]*$/gim;
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
