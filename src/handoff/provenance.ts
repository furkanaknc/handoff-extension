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
