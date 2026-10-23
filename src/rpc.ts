import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

export type RpcMessage = {
  id?: string | number;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { code: number; message: string };
};
const MAX_LINE_BYTES = 8 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;

export class RpcPeer {
  private sequence = 0;
  private buffer = "";
  private closed = false;
  private decoder = new StringDecoder("utf8");
  private pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();

  constructor(
    input: Readable,
    private output: Writable,
    private onEvent: (message: RpcMessage) => void,
    private timeout = REQUEST_TIMEOUT_MS,
    private onClosed: (error: Error) => void = () => {},
  ) {
    input.on("data", (chunk: Buffer) =>
      this.receive(this.decoder.write(chunk)),
    );
    input.on("end", () =>
      this.close(new Error("Codex disconnected. Reconnect to continue.")),
    );
    input.on("error", (error) => this.close(error));
    output.on("error", (error) => this.close(error));
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.closed)
      return Promise.reject(
        new Error("Codex is disconnected. Reconnect to continue."),
      );
    const id = ++this.sequence;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`Codex ${method} timed out. Reconnect and try again.`),
        );
      }, this.timeout);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      this.write({ id, method, params });
    });
  }

  write(message: unknown) {
    if (this.closed) throw new Error("Codex is disconnected.");
    this.output.write(`${JSON.stringify(message)}\n`);
  }

  close(error = new Error("Codex connection closed.")) {
    if (this.closed) return;
    this.closed = true;
    for (const call of this.pending.values()) {
      clearTimeout(call.timer);
      call.reject(error);
    }
    this.pending.clear();
    this.onClosed(error);
  }

  private receive(chunk: string) {
    if (this.closed) return;
    this.buffer += chunk;
    if (Buffer.byteLength(this.buffer) > MAX_LINE_BYTES) {
      this.close(new Error("Codex sent an oversized message."));
      return;
    }
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (line.trim()) this.dispatch(line);
      newline = this.buffer.indexOf("\n");
    }
  }

  private dispatch(line: string) {
    let message: RpcMessage;
    try {
      const parsed: unknown = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("Invalid envelope");
      message = parsed as RpcMessage;
    } catch {
      this.close(
        new Error("Codex returned malformed JSON. Reconnect to continue."),
      );
      return;
    }
    if (message.method) {
      this.onEvent(message);
      return;
    }
    if (typeof message.id !== "number") return;
    const call = this.pending.get(message.id);
    if (!call) return;
    clearTimeout(call.timer);
    this.pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error.message));
    else call.resolve(message.result);
  }
}
