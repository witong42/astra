import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { startRemoteServer } from "../src/remote-server";
import { MAX_CANVAS_BYTES } from "../src/substrate-protocol";
import { INITIAL_VOICE } from "../src/voice";
import {
  ORIGIN,
  REMOTE_STREAM_ARGUMENT,
  remoteFixture,
  SLOW_PHONE_TIMEOUT_MS,
  slowPhone,
} from "./remote-stream";

const NATIVE_REPLAY_TIMEOUT_MS = 20_000;
const NATIVE_TEST_TIMEOUT_MS = 25_000;
const servers: Awaited<ReturnType<typeof startRemoteServer>>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

async function fixture(connecting?: () => Promise<void>) {
  const context = await remoteFixture(connecting);
  servers.push(context.server);
  return context;
}

async function stream(context: Awaited<ReturnType<typeof fixture>>) {
  const clientId = crypto.randomUUID();
  const abort = new AbortController();
  const response = await fetch(`${context.url}/events?clientId=${clientId}`, {
    headers: context.headers,
    signal: abort.signal,
  });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Missing event stream");
  let buffer = "";
  const decoder = new TextDecoder();
  const next = async (): Promise<Record<string, unknown>> => {
    for (;;) {
      const end = buffer.indexOf("\n\n");
      if (end >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame
          .split("\n")
          .find((line) => line.startsWith("data: "));
        if (data) return JSON.parse(data.slice(6));
      } else {
        const value = await reader.read();
        if (value.done) throw new Error("Event stream closed");
        buffer += decoder.decode(value.value, { stream: true });
      }
    }
  };
  return { clientId, next, close: () => abort.abort() };
}

test("the phone bridge accepts only the configured origin and verified Tailscale owner", async () => {
  const f = await fixture();
  const request = {
    method: "snapshot",
    args: [],
    clientId: crypto.randomUUID(),
  };
  expect((await f.call(request, { "Tailscale-User-Login": "" })).status).toBe(
    403,
  );
  expect(
    (await f.call(request, { "Tailscale-User-Login": "other@example.com" }))
      .status,
  ).toBe(403);
  expect(
    (await f.call(request, { Origin: "https://unrelated.example" })).status,
  ).toBe(403);
  expect(f.calls).toHaveLength(0);
  const response = await f.call(request);
  expect(response.status).toBe(200);
  expect(response.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  expect(await response.json()).toEqual({
    ok: true,
    result: f.snapshot,
  });
  expect(f.calls).toEqual([request]);
  expect(f.server.server.address()).toMatchObject({ address: "127.0.0.1" });
});

test("a phone waits for the desktop save before taking ownership, and a second phone cannot overwrite it", async () => {
  let finish!: () => void;
  const f = await fixture(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  let opened = false;
  const first = stream(f).then((phone) => {
    opened = true;
    return phone;
  });
  while (!finish) await new Promise((resolve) => setTimeout(resolve, 0));
  expect(opened).toBe(false);
  const second = await fetch(
    `${f.url}/events?clientId=${crypto.randomUUID()}`,
    { headers: f.headers },
  );
  expect(second.status).toBe(429);
  finish();
  const phone = await first;
  expect((await phone.next()).type).toBe("ready");
  phone.close();
});

test("snapshot responses are compressed and a valid canvas survives JSON escape expansion", async () => {
  const f = await fixture();
  f.snapshot.activity = "Shared snapshot ".repeat(1000);
  const response = await f.call(
    { method: "snapshot", args: [], clientId: crypto.randomUUID() },
    { "Accept-Encoding": "gzip" },
  );
  expect(response.headers.get("content-encoding")).toBe("gzip");
  expect((await response.json()).result.activity).toBe(f.snapshot.activity);
  const client = await stream(f);
  try {
    const update = await f.call({
      method: "updateCanvas",
      clientId: client.clientId,
      args: [
        f.snapshot.activeId,
        { revision: 0, html: "\\".repeat(MAX_CANVAS_BYTES), css: "" },
      ],
    });
    expect(update.status).toBe(200);
    expect((await update.json()).result.confirmed).toBe("updateCanvas");
  } finally {
    client.close();
  }
});

test("unrecognized methods, malformed input and GET requests cannot invoke the Mac", async () => {
  const f = await fixture();
  for (const body of [
    { method: "constructor", args: [], clientId: crypto.randomUUID() },
    { method: "snapshot", args: [], clientId: "not-a-client" },
    {
      method: "snapshot",
      args: [],
      clientId: crypto.randomUUID(),
      extra: true,
    },
  ])
    expect((await f.call(body)).status).toBe(400);
  expect((await fetch(`${f.url}/call`, { headers: f.headers })).status).toBe(
    405,
  );
  expect(f.calls).toHaveLength(0);
  const preflight = await fetch(`${f.url}/call`, {
    method: "OPTIONS",
    headers: f.headers,
  });
  expect(preflight.status).toBe(204);
  expect(f.calls).toHaveLength(0);
});

test("phone clients receive the same initial state and subsequent workspace and voice updates", async () => {
  const f = await fixture();
  const phone = await stream(f);
  expect(await phone.next()).toEqual({
    type: "ready",
    clientId: phone.clientId,
  });
  expect(await phone.next()).toEqual({
    type: "snapshot",
    snapshot: f.snapshot,
  });
  expect(await phone.next()).toEqual({
    type: "voice",
    state: INITIAL_VOICE,
    owner: null,
  });
  const changed = { ...f.snapshot, activity: "Editing the shared app" };
  f.server.publishSnapshot(changed);
  expect(await phone.next()).toEqual({ type: "snapshot", snapshot: changed });
  const voice = {
    ...INITIAL_VOICE,
    active: true,
    status: "listening" as const,
  };
  f.server.publishVoice(voice, phone.clientId);
  expect(await phone.next()).toEqual({
    type: "voice",
    state: voice,
    owner: phone.clientId,
  });
  phone.close();
});

for (const compressed of [false, true])
  test(
    `assistant replies preserve a slow phone connection and its latest state (${compressed ? "gzip" : "plain"})`,
    async () => {
      if (process.platform !== "win32") {
        await slowPhone(compressed);
        return;
      }
      const directory = mkdtempSync(join(tmpdir(), "astra-remote-stream-"));
      let child: ReturnType<typeof Bun.spawn> | undefined;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        const built = await Bun.build({
          entrypoints: [join(import.meta.dir, "remote-stream.ts")],
          target: "node",
          format: "esm",
        });
        if (!built.success) throw new AggregateError(built.logs);
        const script = join(directory, "remote-stream.mjs");
        writeFileSync(script, await built.outputs[0].text());
        const electron = join(import.meta.dir, "../node_modules/electron");
        const executable = join(
          electron,
          "dist",
          readFileSync(join(electron, "path.txt"), "utf8").trim(),
        );
        // The app uses Node; Bun's Windows HTTP pause/resume stalls this replay.
        const replay = Bun.spawn(
          [
            executable,
            script,
            REMOTE_STREAM_ARGUMENT,
            compressed ? "gzip" : "plain",
          ],
          {
            env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
            stdout: "pipe",
            stderr: "pipe",
          },
        );
        child = replay;
        timeout = setTimeout(() => child?.kill(), NATIVE_REPLAY_TIMEOUT_MS);
        const [code, stdout, stderr] = await Promise.all([
          replay.exited,
          new Response(replay.stdout).text(),
          new Response(replay.stderr).text(),
        ]);
        expect({ code, stdout, stderr }).toEqual({
          code: 0,
          stdout: "",
          stderr: "",
        });
      } finally {
        if (timeout) clearTimeout(timeout);
        if (child && child.exitCode === null) {
          child.kill();
          await child.exited;
        }
        rmSync(directory, { recursive: true, force: true });
      }
    },
    process.platform === "win32"
      ? NATIVE_TEST_TIMEOUT_MS
      : SLOW_PHONE_TIMEOUT_MS,
  );

test("UI commands require their targeted client receipt and fail when the phone disconnects", async () => {
  const f = await fixture();
  const phone = await stream(f);
  for (let index = 0; index < 3; index++) await phone.next();
  const command = {
    kind: "interface" as const,
    request: { action: "home" as const },
  };
  const pending = f.server.requestClient(phone.clientId, command);
  const event = await phone.next();
  expect(event).toMatchObject({ type: "command", command });
  const result = {
    clientId: phone.clientId,
    id: event.id,
    result: { screen: "home" },
  };
  const wrong = await fetch(`${f.url}/result`, {
    method: "POST",
    headers: f.headers,
    body: JSON.stringify({ ...result, clientId: crypto.randomUUID() }),
  });
  expect(wrong.status).toBe(409);
  expect(
    (
      await fetch(`${f.url}/result`, {
        method: "POST",
        headers: f.headers,
        body: JSON.stringify(result),
      })
    ).status,
  ).toBe(200);
  expect(await pending).toEqual({ screen: "home" });
  const stopped = f.server
    .requestClient(phone.clientId, command)
    .catch((error) => error.message);
  await phone.next();
  phone.close();
  expect(await stopped).toContain("disconnected");
});
