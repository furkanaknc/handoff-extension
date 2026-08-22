import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { HandoffError } from "../handoff/errors";

interface PendingRequest {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

interface RpcMessage {
  id?: unknown;
  result?: unknown;
  error?: { message?: unknown };
}

export class CodexAppServerClient {
  private process: ChildProcessWithoutNullStreams | undefined;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private closed = false;

  constructor(
    private readonly executablePath: string,
    private readonly executableArgs: string[] = ["app-server"],
    private readonly timeoutMs = 15_000,
  ) {}

  async connect(): Promise<void> {
    if (this.process) {
      return;
    }

    const child = spawn(this.executablePath, this.executableArgs, {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.process = child;
    child.stdin.on("error", (error) => this.failAll(error));
    child.stderr.on("data", () => {
      // Drain diagnostics without logging potentially sensitive paths.
    });
    child.once("error", (error) => this.failAll(error));
    child.once("exit", (code) => {
      if (!this.closed) {
        this.failAll(
          new Error(`Codex app-server exited unexpectedly (${String(code)}).`),
        );
      }
    });

    const lines = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });
    lines.on("line", (line) => this.receiveLine(line));

    await this.request("initialize", {
      clientInfo: {
        name: "cursor_codex_handoff",
        title: "Cursor Codex Handoff",
        version: "0.0.12",
      },
    });
    this.notify("initialized", {});
  }

  async request<T>(method: string, params: unknown): Promise<T> {
    const child = this.process;
    if (!child || this.closed) {
      throw new HandoffError(
        "CODEX_APP_SERVER_FAILED",
        "Codex app-server is not available.",
      );
    }

    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new HandoffError(
            "CODEX_APP_SERVER_FAILED",
            `Codex app-server did not answer ${method} in time.`,
          ),
        );
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    });
  }

  close(): void {
    this.closed = true;
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error("Codex app-server connection closed."));
    }
    this.pending.clear();
    this.process?.kill();
    this.process = undefined;
  }

  private notify(method: string, params: unknown): void {
    this.process?.stdin.write(`${JSON.stringify({ method, params })}\n`);
  }

  private receiveLine(line: string): void {
    if (line.trim().length === 0) {
      return;
    }
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch (error) {
      this.failAll(
        new HandoffError(
          "CODEX_PROTOCOL_INVALID",
          "Codex app-server returned malformed protocol data.",
          { cause: error },
        ),
      );
      return;
    }

    if (typeof message.id !== "number") {
      return;
    }
    const request = this.pending.get(message.id);
    if (!request) {
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) {
      request.reject(
        new HandoffError(
          "CODEX_APP_SERVER_FAILED",
          "Codex app-server rejected a conversation request.",
        ),
      );
    } else {
      request.resolve(message.result);
    }
  }

  private failAll(error: Error): void {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(
        error instanceof HandoffError
          ? error
          : new HandoffError(
              "CODEX_APP_SERVER_FAILED",
              "Codex app-server could not be started or stopped unexpectedly.",
              { cause: error },
            ),
      );
    }
    this.pending.clear();
  }
}
