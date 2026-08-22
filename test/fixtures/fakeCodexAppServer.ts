import readline from "node:readline";

const mode = process.argv[2] ?? "normal";
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

lines.on("line", (line) => {
  const message = JSON.parse(line) as { method?: string; id?: number };
  if (message.method === "initialize") {
    send({ id: message.id, result: { userAgent: "fake" } });
    return;
  }
  if (message.method === "thread/list") {
    if (mode === "timeout") {
      return;
    }
    if (mode === "crash") {
      process.exit(7);
    }
    if (mode === "malformed") {
      process.stdout.write("not-json\n");
      return;
    }
    send({ id: message.id, result: { data: [{ id: "thread-id" }] } });
    return;
  }
  if (message.method === "thread/read") {
    send({
      id: message.id,
      result: { thread: { id: "thread-id", turns: [] } },
    });
  }
});
