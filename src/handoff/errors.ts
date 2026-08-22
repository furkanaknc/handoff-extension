export type HandoffErrorCode =
  | "HOOK_CONFIG_INVALID"
  | "HOOK_NOT_READY"
  | "POINTER_INVALID"
  | "TRANSCRIPT_MISSING"
  | "CONVERSATION_EMPTY"
  | "CODEX_NOT_INSTALLED"
  | "CODEX_COMMAND_MISSING"
  | "CODEX_TRANSFER_FAILED";

export class HandoffError extends Error {
  constructor(
    public readonly code: HandoffErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "HandoffError";
  }
}
