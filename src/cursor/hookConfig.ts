export const HOOK_MARKER = "--handoff-cursor-hook";
export const HANDOFF_HOOK_EVENTS = [
  "beforeSubmitPrompt",
  "afterAgentResponse",
] as const;

interface HookDefinition {
  command?: unknown;
  [key: string]: unknown;
}

export interface CursorHooksConfig {
  version?: unknown;
  hooks?: unknown;
  [key: string]: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function hasCurrentHandoffHooks(
  config: CursorHooksConfig,
  expectedCommand: string,
): boolean {
  if (!isObject(config.hooks)) {
    return false;
  }
  const hooks: Record<string, unknown> = config.hooks;

  return HANDOFF_HOOK_EVENTS.every((eventName) => {
    const entries = hooks[eventName];
    return (
      Array.isArray(entries) &&
      entries.some(
        (entry) =>
          isObject(entry) &&
          typeof entry.command === "string" &&
          entry.command === expectedCommand,
      )
    );
  });
}

export function hasOwnedHandoffHooks(config: CursorHooksConfig): boolean {
  if (!isObject(config.hooks)) {
    return false;
  }
  const hooks: Record<string, unknown> = config.hooks;
  return HANDOFF_HOOK_EVENTS.some((eventName) => {
    const entries = hooks[eventName];
    return (
      Array.isArray(entries) &&
      entries.some(
        (entry) =>
          isObject(entry) &&
          typeof entry.command === "string" &&
          entry.command.includes(HOOK_MARKER),
      )
    );
  });
}

export function mergeHandoffHooks(
  config: CursorHooksConfig,
  command: string,
): CursorHooksConfig {
  if (config.version !== undefined && config.version !== 1) {
    throw new Error(`Unsupported Cursor hooks.json version: ${String(config.version)}`);
  }

  const hooks: Record<string, unknown> = isObject(config.hooks)
    ? { ...config.hooks }
    : {};

  for (const eventName of HANDOFF_HOOK_EVENTS) {
    const existing = Array.isArray(hooks[eventName])
      ? (hooks[eventName] as HookDefinition[])
      : [];
    hooks[eventName] = [
      ...existing.filter(
        (entry) =>
          !isObject(entry) ||
          typeof entry.command !== "string" ||
          !entry.command.includes(HOOK_MARKER),
      ),
      { command, timeout: 5 },
    ];
  }

  return { ...config, version: 1, hooks };
}

export function removeHandoffHooks(config: CursorHooksConfig): CursorHooksConfig {
  if (!isObject(config.hooks)) {
    return { ...config };
  }
  const hooks: Record<string, unknown> = { ...config.hooks };
  for (const [eventName, value] of Object.entries(hooks)) {
    if (!Array.isArray(value)) {
      continue;
    }
    const remaining = value.filter(
      (entry) =>
        !isObject(entry) ||
        typeof entry.command !== "string" ||
        !entry.command.includes(HOOK_MARKER),
    );
    if (remaining.length === 0) {
      delete hooks[eventName];
    } else {
      hooks[eventName] = remaining;
    }
  }
  return { ...config, hooks };
}
