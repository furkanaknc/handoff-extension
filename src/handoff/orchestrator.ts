import type {
  CodexTarget,
  CursorConversationSource,
  GitContext,
  HandoffContext,
} from "./types";

export type GitContextProvider = (
  workspacePath: string,
) => Promise<GitContext>;

export async function performCursorToCodexHandoff(
  workspacePath: string,
  source: CursorConversationSource,
  target: CodexTarget,
  getRepositoryContext: GitContextProvider,
  now: () => Date = () => new Date(),
): Promise<HandoffContext> {
  const [conversation, repository] = await Promise.all([
    source.getCurrentConversation(workspacePath),
    getRepositoryContext(workspacePath),
  ]);

  const context: HandoffContext = {
    source: "cursor",
    workspacePath,
    conversation,
    repository,
    metadata: { createdAt: now().toISOString() },
  };

  await target.sendHandoff(context);
  return context;
}
