import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { get, type IncomingMessage, type ServerResponse } from "node:http";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { createGunzip } from "node:zlib";
import { startRemoteServer } from "../src/remote-server";
import { newWorkspace } from "../src/storage";
import type { Snapshot } from "../src/types";
import { INITIAL_VOICE } from "../src/voice";

export const ORIGIN = "https://astra.example.chatgpt.site";
const OWNER = "owner@example.com";
const LARGE_ASSET_BLOCK_BYTES = 64 * 1024;
const LARGE_ASSET_REPEATS = 180;
const SNAPSHOT_WAIT_MS = 300;
const DRAIN_POLL_MS = 10;
export const SLOW_PHONE_TIMEOUT_MS = 10_000;
export const REMOTE_STREAM_ARGUMENT = "--astra-remote-stream";

export async function remoteFixture(connecting?: () => Promise<void>) {
  const calls: unknown[] = [];
  const workspace = newWorkspace("/tmp");
  const snapshot: Snapshot = {
    version: 1,
    activeId: workspace.id,
    workspaces: [workspace],
    sessions: {},
    model: "test",
    reasoningEffort: "low",
    serviceTier: "default",
    status: "ready",
    activity: "Ready",
    account: "ChatGPT",
    backendVersion: "test",
    models: [],
    approval: null,
    error: null,
    metrics: null,
  };
  const server = await startRemoteServer(
    { origin: ORIGIN, user: OWNER, port: 0 },
    {
      connecting,
      snapshot: () => snapshot,
      voice: () => ({ state: INITIAL_VOICE, owner: null }),
      invoke: async (method, args, clientId) => {
        calls.push({ method, args, clientId });
        return method === "snapshot" ? snapshot : { confirmed: method };
      },
    },
  );
  const address = server.server.address();
  if (!address || typeof address === "string") throw new Error("No test port");
  const url = `http://127.0.0.1:${address.port}`;
  const headers = {
    Origin: ORIGIN,
    "Tailscale-User-Login": OWNER,
    "Content-Type": "application/json",
  };
  const call = (body: unknown, extra: Record<string, string> = {}) =>
    fetch(`${url}/call`, {
      method: "POST",
      headers: { ...headers, ...extra },
      body: JSON.stringify(body),
    });
  return { server, calls, snapshot, url, headers, call };
}

export async function slowPhone(compressed: boolean) {
  const f = await remoteFixture();
  f.snapshot.workspaces[0].spec.state = {
    asset: randomBytes(LARGE_ASSET_BLOCK_BYTES)
      .toString("base64")
      .repeat(LARGE_ASSET_REPEATS),
  };
  const clientId = crypto.randomUUID();
  let transport: ServerResponse | undefined;
  f.server.server.once("request", (_request, response) => {
    transport = response;
  });
  let response: IncomingMessage | undefined;
  let output: IncomingMessage | ReturnType<typeof createGunzip> | undefined;
  const seen: { type: string; activity?: string; status?: string }[] = [];
  const receipts: Promise<Response>[] = [];
  let confirmation: Promise<unknown> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      get(
        `${f.url}/events?clientId=${clientId}`,
        {
          headers: {
            ...f.headers,
            "Accept-Encoding": compressed ? "gzip" : "identity",
          },
        },
        (stream) => {
          response = stream;
          output = compressed ? stream.pipe(createGunzip()) : stream;
          output.setEncoding("utf8");
          output.on("error", reject);
          createInterface({ input: output }).on("line", (frame) => {
            if (!frame.startsWith("data: ")) return;
            const event = JSON.parse(frame.slice(6));
            seen.push({
              type: event.type,
              activity: event.snapshot?.activity,
              status: event.state?.status,
            });
            if (event.type === "command" && event.id)
              receipts.push(
                fetch(`${f.url}/result`, {
                  method: "POST",
                  headers: f.headers,
                  body: JSON.stringify({
                    clientId,
                    id: event.id,
                    result: { screen: "home" },
                  }),
                }),
              );
            if (seen.length === 3) {
              output?.pause();
              response?.pause();
              resolve();
            }
          });
        },
      ).on("error", reject);
    });
    if (!transport) throw new Error("Missing event-stream response");
    // Hold writes so OS receive-buffer sizes cannot bypass the paused phone.
    transport.cork();
    for (const activity of [
      "First reply",
      "Superseded reply",
      "Latest reply",
    ]) {
      f.server.publishSnapshot({ ...f.snapshot, activity });
      await sleep(SNAPSHOT_WAIT_MS);
      f.server.publishVoice(
        { ...INITIAL_VOICE, active: true, status: "speaking" },
        clientId,
      );
      if (activity === "First reply")
        confirmation = f.server
          .requestClient(clientId, {
            kind: "interface",
            request: { action: "home" },
          })
          .catch((error) => ({ error: error.message }));
    }
    assert.equal(f.server.activeClient(), clientId);
    transport.uncork();
    output?.resume();
    response?.resume();
    const deadline = Date.now() + SLOW_PHONE_TIMEOUT_MS / 2;
    while (
      !seen.some((event) => event.activity === "Latest reply") ||
      !seen.some((event) => event.status === "speaking")
    ) {
      if (Date.now() >= deadline)
        throw new Error(
          "The phone did not receive the latest reply after draining.",
        );
      await sleep(DRAIN_POLL_MS);
    }
    assert.equal(f.server.activeClient(), clientId);
    assert.deepEqual(await confirmation, { screen: "home" });
    for (const receipt of await Promise.all(receipts))
      assert.equal(receipt.status, 200);
    assert.equal(
      seen.filter((event) => event.activity === "Superseded reply").length,
      0,
    );
  } finally {
    transport?.uncork();
    output?.destroy();
    response?.destroy();
    await f.server.close();
  }
}

if (process.argv[2] === REMOTE_STREAM_ARGUMENT) {
  const encoding = process.argv[3];
  if (encoding !== "plain" && encoding !== "gzip")
    throw new Error("Choose plain or gzip for the remote-stream replay.");
  const timeout = setTimeout(() => {
    console.error("The slow-phone replay exceeded its ten-second deadline.");
    process.exit(1);
  }, SLOW_PHONE_TIMEOUT_MS);
  try {
    await slowPhone(encoding === "gzip");
  } finally {
    clearTimeout(timeout);
  }
}
