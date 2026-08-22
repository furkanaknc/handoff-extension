export type HandoffRole = "user" | "assistant";

export interface HandoffMessage {
  role: HandoffRole;
  content: string;
}

export interface Conversation {
  id?: string;
  messages: HandoffMessage[];
  truncated: boolean;
}

export interface GitContext {
  head?: string;
  branch?: string;
  changedFiles: string[];
  diffStat?: string;
  diff?: string;
  diffTruncated: boolean;
}

export interface HandoffContext {
  source: "cursor" | "codex";
  workspacePath: string;
  conversation?: Conversation;
  repository: GitContext;
  metadata: {
    createdAt: string;
  };
}

export interface CursorConversationSource {
  getCurrentConversation(workspacePath: string): Promise<Conversation>;
}

export interface CodexConversationSource {
  getCurrentConversation(workspacePath: string): Promise<Conversation>;
}

export interface CodexTarget {
  sendHandoff(context: HandoffContext): Promise<void>;
}

export interface CursorTarget {
  sendHandoff(context: HandoffContext): Promise<void>;
}
