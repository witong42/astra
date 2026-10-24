import { afterEach, expect, test } from "bun:test";
import { newWorkspace } from "../src/storage";
import type { Snapshot } from "../src/types";
import { WebBridge } from "../src/web-bridge";

const originalWindow = globalThis.window;
const originalEvents = globalThis.EventSource;
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.window = originalWindow;
  globalThis.EventSource = originalEvents;
  globalThis.fetch = originalFetch;
});

function fixture() {
  let events: FakeEvents;
  class FakeEvents {
    onmessage: ((event: { data: string }) => void) | null = null;
    onerror: (() => void) | null = null;
    constructor() {
      events = this;
    }
    close() {}
  }
  const calls: { path: string; body: Record<string, unknown> }[] = [];
  globalThis.EventSource = FakeEvents as unknown as typeof EventSource;
  globalThis.window = { addEventListener() {} } as unknown as Window &
    typeof globalThis;
  globalThis.fetch = (async (
    url: string | URL | Request,
    options?: RequestInit,
  ) => {
    calls.push({ path: String(url), body: JSON.parse(String(options?.body)) });
    return Response.json({
      ok: true,
      result: calls.at(-1)?.body.method === "snapshot" ? snapshot : null,
    });
  }) as unknown as typeof fetch;
  const bridge = new WebBridge("https://mac.example:8443", () => {});
  const app = newWorkspace("/tmp");
  const snapshot: Snapshot = {
    version: 1,
    activeId: app.id,
    model: "test",
    reasoningEffort: "low",
    serviceTier: "default",
    workspaces: [app],
    sessions: {},
    status: "ready",
    activity: "Ready",
    account: "",
    backendVersion: "test",
    models: [],
    approval: null,
    error: null,
    metrics: null,
  };
  const emit = (value: unknown) =>
    events.onmessage?.({ data: JSON.stringify(value) });
  emit({ type: "ready", clientId: "unused" });
  emit({ type: "snapshot", snapshot });
  return {
    bridge,
    calls,
    emit,
    disconnect: () => events.onerror?.(),
    snapshot,
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("web clients use the shared Mac snapshot and never replay a failed mutation after reconnecting", async () => {
  const f = fixture();
  expect((await f.bridge.bridge.snapshot()).activeId).toBe(f.snapshot.activeId);
  let activity = "";
  f.bridge.bridge.subscribe((snapshot) => {
    activity = snapshot.activity;
  });
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts++;
    throw new Error("connection lost after dispatch");
  }) as unknown as typeof fetch;
  await expect(f.bridge.bridge.newWorkspace()).rejects.toThrow(
    "after dispatch",
  );
  f.disconnect();
  await expect(f.bridge.bridge.newWorkspace()).rejects.toThrow("déconnecté");
  f.emit({ type: "ready", clientId: "unused" });
  f.emit({
    type: "snapshot",
    snapshot: { ...f.snapshot, activity: "Recovered" },
  });
  await tick();
  expect(attempts).toBe(1);
  expect(activity).toBe("Recovered");
});

test("explicit snapshot reads the Mac after a mutation even before the throttled event arrives", async () => {
  const f = fixture();
  f.snapshot.activity = "New workspace created";
  expect((await f.bridge.ready).activity).toBe("Ready");
  expect((await f.bridge.bridge.snapshot()).activity).toBe(
    "New workspace created",
  );
});

test("Mac interface commands are acknowledged only after the phone interface finishes, and report its actual errors", async () => {
  const f = fixture();
  let finish!: () => void;
  window.astraControl = async () => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    return { surface: "phone" } as never;
  };
  const id = crypto.randomUUID();
  f.emit({
    type: "command",
    id,
    command: { kind: "interface", request: { action: "home" } },
  });
  await tick();
  expect(f.calls).toHaveLength(0);
  finish();
  await tick();
  expect(f.calls[0].body).toMatchObject({ id, result: { surface: "phone" } });
  window.astraControl = async () => {
    throw new Error("phone surface failed");
  };
  f.emit({
    type: "command",
    id: crypto.randomUUID(),
    command: { kind: "interface", request: { action: "home" } },
  });
  await tick();
  expect(f.calls[1].body.error).toBe("phone surface failed");
});
