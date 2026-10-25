import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { INITIAL_VOICE, type VoiceState } from "../src/voice";

const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const disconnected = main.match(
  /disconnected:\s*(\(clientId\) => \{[\s\S]*?\n\s*\}),\s*invoke: invokeRemote/,
);
if (!disconnected)
  throw new Error("Astra's phone disconnect handler is missing.");
const disconnectHandler = disconnected[1];
const connecting = main.match(
  /connecting:\s*(async \(\) => \{[\s\S]*?\n\s*\}),\s*snapshot:/,
);
if (!connecting)
  throw new Error("Astra's phone connection handler is missing.");
const connectHandler = connecting[1];
const controller = new Bun.Transpiler({
  loader: "ts",
  target: "node",
}).transformSync(
  main.slice(
    main.indexOf("function releasePhoneInput()"),
    main.indexOf("async function createWindow()"),
  ),
);

function fixture() {
  const input = {
    clientId: "phone",
    input: {},
    disposed: false,
    dispose() {
      this.disposed = true;
    },
  };
  let voice: VoiceState = {
    ...INITIAL_VOICE,
    active: true,
    status: "listening",
  };
  let desktopStarts = 0;
  let stops = 0;
  let menu: { label?: string; enabled?: boolean; click?: () => void }[] = [];
  const context = {
    remoteActive: false,
    phoneInput: input as typeof input | null,
    voiceTransfer: 0,
    changingVoice: 0,
    desktopVoiceWasActive: true,
    quitting: false,
    trayStatus: "",
    window: null,
    remote: null,
    flushRenderer: async () => {},
    backend: { state: {}, snapshot: () => ({}), setVoiceEnabled() {} },
    broadcast() {},
    voice: {
      snapshot: () => voice,
      start: async (standby: boolean, source: unknown) => {
        if (source === null) desktopStarts++;
        voice = {
          ...voice,
          active: true,
          status: standby ? "standby" : "listening",
        };
      },
      stop: () => {
        stops++;
        voice = { ...voice, active: false };
      },
    },
    tray: {
      setToolTip() {},
      setContextMenu(value: typeof menu) {
        menu = value;
      },
    },
    Menu: { buildFromTemplate: (value: typeof menu) => value },
  };
  const actions = runInNewContext(
    `${controller}\n({ startVoiceInput, setRemoteActive, updateVoice, connecting: ${connectHandler}, disconnected: ${disconnectHandler} })`,
    context,
  ) as {
    startVoiceInput: (
      standby: boolean,
      source: typeof input | null,
    ) => Promise<void>;
    setRemoteActive: (active: boolean) => void;
    updateVoice: (state: typeof voice) => void;
    disconnected: (clientId: string) => void;
    connecting: () => Promise<void>;
  };
  return {
    actions,
    context,
    input,
    state: () => ({
      desktopStarts,
      stops,
      active: voice.active,
      disposed: input.disposed,
    }),
    menu: () => menu,
    snapshot: () => voice,
  };
}

test("desktop voice starts cannot release a microphone owned by the phone", async () => {
  const f = fixture();
  f.actions.setRemoteActive(true);
  await expect(f.actions.startVoiceInput(true, null)).rejects.toThrow(
    "active on the phone",
  );
  expect(f.state()).toEqual({
    desktopStarts: 0,
    stops: 0,
    active: true,
    disposed: false,
  });
  expect(f.context.phoneInput).toBe(f.input);
  expect(f.context.voiceTransfer).toBe(0);
});

test("desktop voice remains available after the phone releases ownership", async () => {
  const f = fixture();
  f.actions.setRemoteActive(true);
  f.actions.setRemoteActive(false);
  await f.actions.startVoiceInput(true, null);
  expect(f.state().desktopStarts).toBe(1);
  expect(f.input.disposed).toBe(true);
});

test("phone voice can start while the phone owns Astra", async () => {
  const f = fixture();
  f.actions.setRemoteActive(true);
  const next = { ...f.input, disposed: false };
  await f.actions.startVoiceInput(false, next);
  expect(f.context.phoneInput).toBe(next);
  expect(f.input.disposed).toBe(true);
  expect(next.disposed).toBe(false);
  expect(f.state().desktopStarts).toBe(0);
});

test("a phone disconnect restores previously enabled desktop wake listening", async () => {
  const f = fixture();
  f.context.phoneInput = null;
  await f.actions.connecting();
  await f.actions.startVoiceInput(false, f.input);
  f.actions.disconnected(f.input.clientId);
  await Promise.resolve();
  expect(f.context.remoteActive).toBe(false);
  expect(f.context.phoneInput).toBeNull();
  expect(f.state()).toEqual({
    desktopStarts: 1,
    stops: 2,
    active: true,
    disposed: true,
  });
  expect(f.snapshot().status).toBe("standby");
  expect(f.context.desktopVoiceWasActive).toBe(false);
});

test("phone disconnect never enables a previously disabled desktop microphone or restarts during quit", async () => {
  for (const [enabled, quitting] of [
    [false, false],
    [true, true],
  ]) {
    const f = fixture();
    f.context.phoneInput = null;
    if (!enabled) f.context.voice.stop();
    await f.actions.connecting();
    await f.actions.startVoiceInput(false, f.input);
    f.context.quitting = quitting;
    f.actions.disconnected(f.input.clientId);
    await Promise.resolve();
    expect(f.state().desktopStarts).toBe(0);
    expect(f.snapshot().active).toBe(false);
  }
});

test("closing the mobile page restores desktop listening even without a phone voice call", async () => {
  const f = fixture();
  f.context.phoneInput = null;
  await f.actions.connecting();
  f.actions.disconnected(f.input.clientId);
  await Promise.resolve();
  expect(f.state().desktopStarts).toBe(1);
  expect(f.snapshot().status).toBe("standby");
});

test("a stale desktop tray action cannot pause a phone conversation", () => {
  const f = fixture();
  f.actions.updateVoice(f.snapshot());
  const staleAction = f
    .menu()
    .find((item) => item.label === "Pause microphone");
  expect(staleAction?.click).toBeDefined();
  f.actions.setRemoteActive(true);
  expect(
    f.menu().find((item) => item.label === "Pause microphone")?.enabled,
  ).toBe(false);
  staleAction?.click?.();
  expect(f.state()).toEqual({
    desktopStarts: 0,
    stops: 0,
    active: true,
    disposed: false,
  });
  f.actions.setRemoteActive(false);
  expect(
    f.menu().find((item) => item.label === "Pause microphone")?.enabled,
  ).toBe(true);
});
