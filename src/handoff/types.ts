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
    handoffId?: string;
    mode?: HandoffMode;
    sourceSessionId?: string;
    targetSessionId?: string;
    previousHandoffId?: string;
  };
}

export type HandoffMode = "full" | "delta" | "repository-only";

export type HandoffDirection = "cursorToCodex" | "codexToCursor";

export interface DirectionSyncState {
  sourceSessionId: string;
  targetSessionId?: string;
  transferredMessageCount: number;
  transferredPrefixHash: string;
  repositoryFingerprint: string;
  lastHandoffId: string;
  lastHandoffAt: string;
  lastMode?: HandoffMode;
}

export type SessionBindingVerificationMethod =
  | "active-state"
  | "explicit-selection"
  | "post-attachment"
  | "other";

export interface SessionBinding {
  cursorConversationId: string;
  codexThreadId: string;
  workspaceHash: string;
  createdAt: string;
  verifiedAt: string;
  verificationMethod: SessionBindingVerificationMethod;
}

export interface ResolvedTargetSession {
  id: string;
  label: string;
  verificationMethod: SessionBindingVerificationMethod;
}

export interface WorkspaceMemory {
  version: 2;
  sessionBinding?: SessionBinding;
  cursorToCodex?: DirectionSyncState;
  codexToCursor?: DirectionSyncState;
}

export interface HandoffPlan {
  mode: HandoffMode;
  messages: HandoffMessage[];
  repository: GitContext;
  nextSyncState: DirectionSyncState;
}

export interface CursorConversationSource {
  getCurrentConversation(workspacePath: string): Promise<Conversation>;
}

export interface CodexConversationSource {
  getCurrentConversation(workspacePath: string): Promise<Conversation>;
}

export interface CodexTarget {
  sendHandoff(
    context: HandoffContext,
    targetSession?: ResolvedTargetSession,
  ): Promise<void | boolean>;
}

export interface CursorTarget {
  sendHandoff(context: HandoffContext): Promise<void | boolean>;
  getTargetSessionId?(workspacePath: string): Promise<string | undefined>;
}

export interface SyncStateStore {
  load(workspacePath: string): Promise<WorkspaceMemory>;
  commitSuccessfulTransfer(
    workspacePath: string,
    direction: HandoffDirection,
    state: DirectionSyncState,
    sessionBinding?: SessionBinding,
  ): Promise<void>;
}
