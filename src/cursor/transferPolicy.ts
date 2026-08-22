export const ADD_FILES_COMMAND = "composer.addfilestocomposer";
export const OPEN_CURSOR_CHAT_COMMAND = "composer.startComposerPrompt2";
export const OPEN_GENERIC_CHAT_COMMAND = "workbench.action.chat.open";

export interface CursorTransferPolicy {
  canAttach: boolean;
  openChatCommand: string;
}

export function cursorTransferPolicy(
  commands: readonly string[],
): CursorTransferPolicy {
  return {
    canAttach: commands.includes(ADD_FILES_COMMAND),
    openChatCommand: commands.includes(OPEN_CURSOR_CHAT_COMMAND)
      ? OPEN_CURSOR_CHAT_COMMAND
      : OPEN_GENERIC_CHAT_COMMAND,
  };
}
