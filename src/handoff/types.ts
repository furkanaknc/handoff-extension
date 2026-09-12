import type { SourceCheckpoint } from "./sourceCursor";

export type HandoffRole = "user" | "assistant";

export interface HandoffMessage {
  role: HandoffRole;
  content: string;
}

export interface Conversation {
  id?: string;
  messages: HandoffMessage[];
  truncated: boolean;
  rawOffset?: number;
  lastTurnId?: string;
}

export interface RepositorySnapshot {
  head?: string;
  branch?: string;
  changedFiles: string[];
  diffStat?: string;
  diffHash?: string;
  diff?: string;
  diffTruncated: boolean;
}

export interface RepositoryHandoffPayload {
  branch?: string;
  head?: string;
  changedFiles: string[];
  diffStat?: string;
  diff?: string;
  diffTruncated?: boolean;
}

export type HandoffMode =
  | "bootstrap"
  | "delta"
  | "repository-only"
  | "recovery";

export type HandoffDirection = "cursorToCodex" | "codexToCursor";

export interface HandoffStats {
  sourceEstimatedTokens: number;
  outgoingEstimatedTokens: number;
  conversationTokens: number;
  repositoryTokens: number;
  metadataTokens: number;
  messagesIncluded: number;
  messagesOmitted: number;
  mode: HandoffMode;
  continuityReason?: string;
}

export interface HandoffContext {
  source: "cursor" | "codex";
  workspacePath: string;
  conversation?: Conversation;
  repository?: RepositoryHandoffPayload;
  metadata: {
    createdAt: string;
    handoffId?: string;
    mode?: HandoffMode;
    sourceSessionId?: string;
    targetSessionId?: string;
    previousHandoffId?: string;
    stats?: HandoffStats;
  };
}

export interface DirectionSyncState {
  sourceSessionId: string;
  targetSessionId?: string;
  sourceCheckpoint?: SourceCheckpoint;
  /** @deprecated Legacy field retained for migration reads only. */
  transferredMessageCount?: number;
  /** @deprecated Legacy field retained for migration reads only. */
  transferredPrefixHash?: string;
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

export interface HandoffManifest {
  handoffId: string;
  direction: HandoffDirection;
  mode: HandoffMode;
  createdAt: string;
  stats: HandoffStats;
  sourceSessionId?: string;
  targetSessionId?: string;
}

export interface WorkspaceMemory {
  version: 3;
  sessionBinding?: SessionBinding;
  cursorToCodex?: DirectionSyncState;
  codexToCursor?: DirectionSyncState;
  recentManifests?: HandoffManifest[];
}

export interface HandoffPlan {
  mode: HandoffMode;
  messages: HandoffMessage[];
  repository?: RepositoryHandoffPayload;
  nextSyncState: DirectionSyncState;
  stats: HandoffStats;
  continuityReason: string;
}

export interface PlanHandoffOptions {
  conversation: Conversation;
  repository: RepositorySnapshot;
  previousState?: DirectionSyncState;
  targetSessionId?: string;
  continuityVerified: boolean;
  handoffId: string;
  createdAt: string;
  includeFullDiff: boolean;
  maxHandoffTokens: number;
  maxConversationTokens: number;
  legacyMessageCap?: number;
  legacyCharacterCap?: number;
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
    manifest?: HandoffManifest,
  ): Promise<void>;
}
