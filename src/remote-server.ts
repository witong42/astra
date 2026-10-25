import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { Writable } from "node:stream";
import { constants, createGzip, gzip } from "node:zlib";
import { z } from "zod";
import type { AppControl } from "./app-control";
import { MAX_CANVAS_BYTES } from "./substrate-protocol";
import type { Snapshot } from "./types";
import type { VoiceState } from "./voice";

const JSON_ESCAPE_EXPANSION = 6;
const REQUEST_METADATA_BYTES = 64 * 1024;
const MAX_REQUEST_BYTES =
  MAX_CANVAS_BYTES * JSON_ESCAPE_EXPANSION + REQUEST_METADATA_BYTES;
const COMPRESSION_THRESHOLD_BYTES = 1024;
const MAX_RPC_ARGS = 4;
const REQUEST_TIMEOUT_MS = 60_000;
const CLIENT_COMMAND_TIMEOUT_MS = 10_000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const SNAPSHOT_INTERVAL_MS = 250;
const MAX_CLIENTS = 1;
const MAX_BUFFERED_BYTES = 16 * 1024 * 1024;
export const REMOTE_METHODS = [
  "snapshot",
  "voiceSnapshot",
  "startVoice",
  "stopVoice",
  "pauseVoice",
  "interruptVoice",
  "runAppleScript",
  "runPowerShell",
  "runShellScript",
  "send",
  "sendAssistant",
  "interrupt",
  "newWorkspace",
  "selectWorkspace",
  "setFavorite",
  "renameWorkspace",
  "deleteWorkspace",
  "chooseFolder",
  "setModel",
  "setReasoningEffort",
  "setServiceTier",
  "updateData",
  "updateCanvas",
  "updateOpenUI",
  "restoreCanvas",
  "answer",
  "reconnect",
  "voiceAudio",
] as const;
export type RemoteMethod = (typeof REMOTE_METHODS)[number];
const callSchema = z
  .object({
    method: z.enum(REMOTE_METHODS),
    args: z.array(z.unknown()).max(MAX_RPC_ARGS),
    clientId: z.string().uuid(),
  })
  .strict();
export type RemoteConfig = { origin: string; user: string; port: number };
export type RemoteCommand =
  | { kind: "interface"; request: AppControl }
  | { kind: "flush" }
  | { kind: "capture"; action: "stop"; captureId: string }
  | ({ kind: "audio"; captureId: string; callId: string } & (
      | { action: "offer"; replayFrom?: number }
      | { action: "answer"; sdp: string }
      | { action: "mute"; muted: boolean }
      | { action: "stop" }
    ));
type Handlers = {
  connecting?: () => Promise<void>;
  snapshot: () => Snapshot;
  voice: () => { state: VoiceState; owner: string | null };
  disconnected?: (clientId: string) => void;
  invoke: (
    method: RemoteMethod,
    args: unknown[],
    clientId: string,
  ) => Promise<unknown>;
};
type ClientEvent =
  | { type: "ready"; clientId: string }
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "voice"; state: VoiceState; owner: string | null }
  | { type: "command"; id: string | null; command: RemoteCommand };
const resultSchema = z
  .object({
    id: z.string().uuid(),
    clientId: z.string().uuid(),
    result: z.unknown().optional(),
    error: z.string().min(1).max(2000).optional(),
  })
  .strict()
  .refine((value) => "result" in value !== "error" in value);

function reply(response: ServerResponse, status: number, body: unknown) {
  if (response.destroyed || response.writableEnded) return;
  const encoded = JSON.stringify(body);
  if (
    Buffer.byteLength(encoded) >= COMPRESSION_THRESHOLD_BYTES &&
    response.req.headers["accept-encoding"]?.includes("gzip")
  ) {
    gzip(encoded, (error, compressed) => {
      if (response.destroyed || response.writableEnded) return;
      if (error) {
        response.writeHead(500, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            ok: false,
            error:
              "Astra could not encode this response. Retry the connection.",
          }),
        );
        return;
      }
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Encoding": "gzip",
      });
      response.end(compressed);
    });
    return;
  }
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(encoded);
}

async function readRequest(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size <= MAX_REQUEST_BYTES) chunks.push(buffer);
    else chunks.length = 0;
  }
  if (size > MAX_REQUEST_BYTES)
    throw new Error("Astra request exceeds the canvas transfer limit.");
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export async function startRemoteServer(
  config: RemoteConfig,
  handlers: Handlers,
) {
  const clients = new Map<
    string,
    {
      response: ServerResponse;
      output: Writable;
      heartbeat: ReturnType<typeof setInterval>;
      queue: { event: ClientEvent; encoded: string | null }[];
      queuedCommandBytes: number;
    }
  >();
  const pending = new Map<
    string,
    {
      clientId: string;
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  let activeClient: string | null = null;
  let connecting = false;
  let snapshotTimer: ReturnType<typeof setTimeout> | null = null;
  let latest: Snapshot | null = null;
  const disconnect = (clientId: string) => {
    const client = clients.get(clientId);
    if (!client) return;
    clients.delete(clientId);
    clearInterval(client.heartbeat);
    client.output.destroy();
    client.response.end();
    if (activeClient === clientId) activeClient = null;
    for (const [id, request] of pending) {
      if (request.clientId !== clientId) continue;
      pending.delete(id);
      clearTimeout(request.timer);
      request.reject(
        new Error("The phone disconnected before confirming the action."),
      );
    }
    handlers.disconnected?.(clientId);
  };
  const flush = (clientId: string) => {
    const client = clients.get(clientId);
    if (!client) return;
    while (!client.output.writableNeedDrain && client.queue.length) {
      const entry = client.queue.shift();
      if (!entry) return;
      if (entry.encoded)
        client.queuedCommandBytes -= Buffer.byteLength(entry.encoded);
      if (
        entry.event.type === "command" &&
        entry.event.id &&
        !pending.has(entry.event.id)
      )
        continue;
      const encoded =
        entry.encoded ?? `data: ${JSON.stringify(entry.event)}\n\n`;
      if (!client.output.write(encoded)) return;
    }
  };
  const send = (clientId: string, event: ClientEvent) => {
    const client = clients.get(clientId);
    if (!client) return;
    const replace =
      event.type === "snapshot" || event.type === "voice"
        ? client.queue.findIndex((entry) => entry.event.type === event.type)
        : -1;
    const encoded =
      event.type === "snapshot" || event.type === "voice"
        ? null
        : `data: ${JSON.stringify(event)}\n\n`;
    if (replace >= 0) client.queue[replace] = { event, encoded };
    else client.queue.push({ event, encoded });
    if (encoded) client.queuedCommandBytes += Buffer.byteLength(encoded);
    if (client.queuedCommandBytes > MAX_BUFFERED_BYTES) {
      disconnect(clientId);
      return;
    }
    flush(clientId);
  };
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "private, no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Vary", "Origin");
    if (
      request.headers.origin !== config.origin ||
      request.headers["tailscale-user-login"] !== config.user
    ) {
      request.resume();
      reply(response, 403, {
        ok: false,
        error: "This device is not authorized for Astra.",
      });
      return;
    }
    response.setHeader("Access-Control-Allow-Origin", config.origin);
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Private-Network", "true");
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    if (path === "/events" && request.method === "GET") {
      const parsed = z
        .string()
        .uuid()
        .safeParse(url.searchParams.get("clientId"));
      if (!parsed.success) {
        reply(response, 400, { ok: false, error: "Invalid phone session." });
        return;
      }
      const clientId = parsed.data;
      if (
        connecting ||
        (!clients.has(clientId) && clients.size >= MAX_CLIENTS)
      ) {
        reply(response, 429, {
          ok: false,
          error: "Close another Astra browser connection before reconnecting.",
        });
        return;
      }
      disconnect(clientId);
      connecting = true;
      try {
        await handlers.connecting?.();
      } catch (error) {
        reply(response, 503, {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
        return;
      } finally {
        connecting = false;
      }
      if (response.destroyed) {
        handlers.disconnected?.(clientId);
        return;
      }
      response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      response.setHeader("X-Accel-Buffering", "no");
      let output: Writable = response;
      if (request.headers["accept-encoding"]?.includes("gzip")) {
        response.setHeader("Content-Encoding", "gzip");
        const gzip = createGzip({ flush: constants.Z_SYNC_FLUSH });
        gzip.pipe(response);
        output = gzip;
      }
      response.flushHeaders();
      const heartbeat = setInterval(() => {
        if (!output.writableNeedDrain) output.write(": heartbeat\n\n");
      }, HEARTBEAT_INTERVAL_MS);
      heartbeat.unref?.();
      const client = {
        response,
        output,
        heartbeat,
        queue: [],
        queuedCommandBytes: 0,
      };
      clients.set(clientId, client);
      output.on("error", () => {
        if (clients.get(clientId) === client) disconnect(clientId);
      });
      output.on("drain", () => {
        if (clients.get(clientId) === client) flush(clientId);
      });
      activeClient = clientId;
      response.once("close", () => {
        if (clients.get(clientId) === client) disconnect(clientId);
      });
      send(clientId, { type: "ready", clientId });
      send(clientId, { type: "snapshot", snapshot: handlers.snapshot() });
      send(clientId, { type: "voice", ...handlers.voice() });
      return;
    }
    if (path !== "/call" && path !== "/result") {
      reply(response, 404, { ok: false, error: "Unknown Astra endpoint." });
      return;
    }
    if (request.method !== "POST") {
      reply(response, 405, {
        ok: false,
        error: "Use POST for an Astra action.",
      });
      return;
    }
    if (!request.headers["content-type"]?.startsWith("application/json")) {
      request.resume();
      reply(response, 415, { ok: false, error: "Astra actions require JSON." });
      return;
    }
    void readRequest(request).then(
      async (input) => {
        if (path === "/result") {
          const parsed = resultSchema.safeParse(input);
          if (!parsed.success) {
            reply(response, 400, {
              ok: false,
              error: "Invalid phone receipt.",
            });
            return;
          }
          const receipt = parsed.data;
          const operation = pending.get(receipt.id);
          if (!operation || operation.clientId !== receipt.clientId) {
            reply(response, 409, {
              ok: false,
              error: "This phone action is no longer pending.",
            });
            return;
          }
          pending.delete(receipt.id);
          clearTimeout(operation.timer);
          if (receipt.error) operation.reject(new Error(receipt.error));
          else operation.resolve(receipt.result);
          reply(response, 200, { ok: true });
          return;
        }
        const parsed = callSchema.safeParse(input);
        if (!parsed.success) {
          reply(response, 400, { ok: false, error: "Invalid Astra action." });
          return;
        }
        const { method, args, clientId } = parsed.data;
        if (method !== "snapshot" && method !== "voiceSnapshot") {
          if (!clients.has(clientId)) {
            reply(response, 409, {
              ok: false,
              error: "Reconnect this phone before sending an action.",
            });
            return;
          }
        }
        try {
          const result = await handlers.invoke(method, args, clientId);
          reply(response, 200, { ok: true, result: result ?? null });
        } catch (error) {
          reply(response, 400, {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },
      (error) =>
        reply(response, 400, {
          ok: false,
          error:
            error instanceof Error ? error.message : "Invalid JSON request.",
        }),
    );
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return {
    server,
    activeClient: () => activeClient,
    clientIds: () => [...clients.keys()],
    notifyClient: (clientId: string, command: RemoteCommand) => {
      send(clientId, { type: "command", id: null, command });
    },
    publishSnapshot: (snapshot: Snapshot) => {
      if (!clients.size) return;
      latest = snapshot;
      if (snapshotTimer) return;
      snapshotTimer = setTimeout(() => {
        snapshotTimer = null;
        for (const clientId of clients.keys())
          send(clientId, { type: "snapshot", snapshot: latest ?? snapshot });
      }, SNAPSHOT_INTERVAL_MS);
    },
    publishVoice: (state: VoiceState, owner: string | null) => {
      for (const clientId of clients.keys())
        send(clientId, { type: "voice", state, owner });
    },
    requestClient: (
      clientId: string,
      command: RemoteCommand,
    ): Promise<unknown> =>
      new Promise((resolve, reject) => {
        if (!clients.has(clientId)) {
          reject(new Error("The phone is disconnected."));
          return;
        }
        const id = crypto.randomUUID();
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(
            new Error(
              "The phone did not confirm the Astra action. Inspect its current state before retrying.",
            ),
          );
        }, CLIENT_COMMAND_TIMEOUT_MS);
        pending.set(id, { clientId, resolve, reject, timer });
        send(clientId, { type: "command", id, command });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        if (snapshotTimer) clearTimeout(snapshotTimer);
        for (const clientId of [...clients.keys()]) disconnect(clientId);
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
