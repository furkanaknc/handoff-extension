import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  normalizeWorkspacePath,
  pointerFileName,
  type CursorConversationPointer,
} from "./pointer";

export interface CursorHookInput {
  conversation_id?: unknown;
  transcript_path?: unknown;
  workspace_roots?: unknown;
  hook_event_name?: unknown;
}

async function readStandardInput(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function stateDirectoryFromArgs(args: string[]): string | undefined {
  const index = args.indexOf("--state-dir");
  return index >= 0 ? args[index + 1] : undefined;
}

export function parseHookInput(raw: string | Buffer): CursorHookInput | undefined {
  const candidates =
    typeof raw === "string"
      ? [raw]
      : [
          raw.toString("utf8").replace(/^\uFEFF/, ""),
          raw.toString("utf16le").replace(/^\uFEFF/, ""),
        ];

  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (value !== null && typeof value === "object") {
        return value as CursorHookInput;
      }
    } catch {
      // Try the next safe decoding. Hook payload contents are never logged.
    }
  }
  return undefined;
}

export function addCursorEnvironmentFallback(
  input: CursorHookInput | undefined,
  environment: NodeJS.ProcessEnv,
): CursorHookInput | undefined {
  const transcriptPath =
    typeof input?.transcript_path === "string" && input.transcript_path.length > 0
      ? input.transcript_path
      : environment.CURSOR_TRANSCRIPT_PATH;
  const workspaceRoot = environment.CURSOR_PROJECT_DIR;
  const workspaceRoots =
    Array.isArray(input?.workspace_roots) && input.workspace_roots.length > 0
      ? input.workspace_roots
      : workspaceRoot
        ? [workspaceRoot]
        : undefined;
  const conversationId =
    typeof input?.conversation_id === "string" && input.conversation_id.length > 0
      ? input.conversation_id
      : transcriptPath
        ? path.basename(transcriptPath, path.extname(transcriptPath))
        : undefined;

  if (!conversationId || !transcriptPath || !workspaceRoots) {
    return input;
  }
  return {
    ...input,
    conversation_id: conversationId,
    transcript_path: transcriptPath,
    workspace_roots: workspaceRoots,
  };
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fs.writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
  try {
    await fs.rename(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

export async function writeConversationPointers(
  input: CursorHookInput,
  stateDirectory: string,
  now: () => Date = () => new Date(),
): Promise<number> {
  if (
    typeof input.conversation_id !== "string" ||
    input.conversation_id.length === 0 ||
    typeof input.transcript_path !== "string" ||
    input.transcript_path.length === 0 ||
    !Array.isArray(input.workspace_roots)
  ) {
    return 0;
  }

  const workspaceRoots = input.workspace_roots.filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (workspaceRoots.length === 0) {
    return 0;
  }

  await fs.mkdir(stateDirectory, { recursive: true });
  const updatedAt = now().toISOString();

  await Promise.all(
    workspaceRoots.map(async (workspaceRoot) => {
      const pointer: CursorConversationPointer = {
        version: 1,
        conversationId: input.conversation_id as string,
        transcriptPath: path.resolve(input.transcript_path as string),
        workspaceRoot: normalizeWorkspacePath(workspaceRoot),
        hookEventName:
          typeof input.hook_event_name === "string"
            ? input.hook_event_name
            : undefined,
        updatedAt,
      };
      const filePath = path.join(stateDirectory, pointerFileName(workspaceRoot));
      await atomicWrite(filePath, `${JSON.stringify(pointer, null, 2)}\n`);
    }),
  );

  return workspaceRoots.length;
}

export async function runCursorHook(args: string[]): Promise<void> {
  const stateDirectory = stateDirectoryFromArgs(args);
  if (!stateDirectory) {
    return;
  }

  const input = addCursorEnvironmentFallback(
    parseHookInput(await readStandardInput()),
    process.env,
  );
  if (input) {
    await writeConversationPointers(input, stateDirectory);
  }
  process.stdout.write("{}\n");
}

if (require.main === module) {
  runCursorHook(process.argv.slice(2)).catch(() => {
    // Cursor command hooks fail open. Do not leak hook payloads in logs.
    process.exitCode = 1;
  });
}
