export type HandoffErrorCode =
  | "HOOK_CONFIG_INVALID"
  | "HOOK_NOT_READY"
  | "POINTER_INVALID"
  | "TRANSCRIPT_MISSING"
  | "CONVERSATION_EMPTY"
  | "CODEX_NOT_INSTALLED"
  | "CODEX_COMMAND_MISSING"
  | "CODEX_TRANSFER_FAILED"
  | "CODEX_APP_SERVER_MISSING"
  | "CODEX_APP_SERVER_FAILED"
  | "CODEX_PROTOCOL_INVALID"
  | "CODEX_THREAD_NOT_FOUND"
  | "CODEX_THREAD_BUSY"
  | "THREAD_SELECTION_CANCELLED"
  | "CURSOR_COMMAND_MISSING"
  | "CURSOR_TRANSFER_FAILED";

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
