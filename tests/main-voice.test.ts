import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { messages } from "../src/locale";
import type { UpdateState } from "../src/updates";
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
const updating = main.match(/onChange:\s*(\(state\) => \{[\s\S]*?\n {6}\}),/);
if (!updating)
  throw new Error("Astra's update notification handler is missing.");
const updateHandler = updating[1];
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
  let update: UpdateState = { status: "idle" };
  let busy = false;
  const updateCalls: string[] = [];
  const errors: string[] = [];
  let menu: {
    label?: string;
    role?: string;
    enabled?: boolean;
    click?: () => void;
  }[] = [];
  const context = {
    remoteActive: false,
    phoneInput: input as typeof input | null,
    voiceTransfer: 0,
    changingVoice: 0,
    desktopVoiceWasActive: true,
    quitting: false,
    installingUpdate: false,
    HIDDEN_TEST_WINDOW: false,
    app: { isPackaged: true },
    updates: { snapshot: () => update },
    messages,
    dialog: {
      showErrorBox: (_title: string, message: string) => errors.push(message),
    },
    PASSIVE_METHODS: new Set(["snapshot"]),
    methods: new Map<string, (...args: unknown[]) => unknown>([
      ["checkForUpdates", () => updateCalls.push("check")],
      ["installUpdate", () => updateCalls.push("install")],
    ]),
    trayStatus: "",
    window: null,
    remote: null,
    get latest() {
      return { sessions: { app: { busy } } };
    },
    flushRenderer: async () => {},
    backend: {
      state: {},
      snapshot: () => ({ sessions: { app: { busy } } }),
      setVoiceEnabled() {},
    },
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
    } as {
      setToolTip: () => void;
      setContextMenu: (value: typeof menu) => void;
    } | null,
    Menu: { buildFromTemplate: (value: typeof menu) => value },
  };
  const actions = runInNewContext(
    `${controller}\n({ startVoiceInput, setRemoteActive, updateVoice, invokeRemote, connecting: ${connectHandler}, disconnected: ${disconnectHandler}, onUpdate: ${updateHandler} })`,
    context,
  ) as {
    startVoiceInput: (
      standby: boolean,
      source: typeof input | null,
    ) => Promise<void>;
    setRemoteActive: (active: boolean) => void;
    updateVoice: (state: typeof voice) => void;
    onUpdate: (state: UpdateState) => void;
    disconnected: (clientId: string) => void;
    connecting: () => Promise<void>;
    invokeRemote: (
      method: string,
      args: unknown[],
      clientId: string,
    ) => Promise<unknown>;
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
    update: (state: UpdateState) => {
      update = state;
      actions.onUpdate(state);
    },
    busy: (value: boolean) => {
      busy = value;
      actions.updateVoice(voice);
    },
    updateCalls,
    errors,
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

test("a phone cannot take ownership while an update is preparing to restart Astra", async () => {
  const f = fixture();
  f.context.installingUpdate = true;
  await expect(f.actions.connecting()).rejects.toThrow("updating");
  expect(f.context.remoteActive).toBe(false);
  expect(f.state().stops).toBe(0);
});

test("a pending phone connection cannot acquire ownership after update preparation starts", async () => {
  const f = fixture();
  let resume!: () => void;
  f.context.flushRenderer = () =>
    new Promise<void>((resolve) => {
      resume = resolve;
    });
  const connecting = f.actions.connecting();
  f.context.installingUpdate = true;
  resume();
  await expect(connecting).rejects.toThrow("updating");
  expect(f.context.remoteActive).toBe(false);
  expect(f.state().stops).toBe(0);
});

test("remote actions cannot start a response during update preparation", async () => {
  const f = fixture();
  f.context.installingUpdate = true;
  f.context.methods.set("send", () => "unexpected remote send");
  await expect(f.actions.invokeRemote("send", [], "phone")).rejects.toThrow(
    "updating",
  );
  f.context.methods.set("snapshot", () => "saved snapshot");
  expect(await f.actions.invokeRemote("snapshot", [], "phone")).toBe(
    "saved snapshot",
  );
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

test("the tray update check sits immediately above Quit and never starts an installation", async () => {
  const f = fixture();
  f.actions.updateVoice(f.snapshot());
  const quit = f.menu().findIndex((item) => item.role === "quit");
  const check = f.menu()[quit - 1];
  expect(check?.label).toBe("Check for updates");
  expect(check?.enabled).toBe(true);
  f.update({ status: "ready", version: "0.6.1" });
  check?.click?.();
  await Bun.sleep(0);
  expect(f.updateCalls).toEqual(["check"]);
  expect(f.state().stops).toBe(0);
});

test("the tray follows update progress without a voice-state change and guards restart while busy", async () => {
  const f = fixture();
  f.actions.updateVoice(f.snapshot());
  f.update({ status: "downloading", percent: 45 });
  expect(f.menu().at(-2)?.label).toBe("Downloading 45%");
  expect(f.menu().at(-2)?.enabled).toBe(false);
  f.update({ status: "ready", version: "0.6.1" });
  expect(f.menu().at(-2)?.label).toBe("Restart to update");
  expect(f.menu().at(-2)?.enabled).toBe(false);
  await f.actions.startVoiceInput(true, null);
  f.actions.updateVoice(f.snapshot());
  expect(f.menu().at(-2)?.enabled).toBe(true);
  f.busy(true);
  expect(f.menu().at(-2)?.enabled).toBe(false);
  f.busy(false);
  f.context.installingUpdate = true;
  f.actions.updateVoice(f.snapshot());
  expect(f.menu().at(-2)?.enabled).toBe(false);
  f.context.installingUpdate = false;
  f.actions.setRemoteActive(true);
  expect(f.menu().at(-2)?.enabled).toBe(false);
  f.actions.setRemoteActive(false);
  f.menu().at(-2)?.click?.();
  await Bun.sleep(0);
  expect(f.updateCalls).toEqual(["install"]);
});

test("a tray update error remains actionable without interrupting voice", async () => {
  const f = fixture();
  f.context.methods.set("checkForUpdates", () => {
    throw new Error("Cannot reach GitHub");
  });
  f.actions.updateVoice(f.snapshot());
  f.menu().at(-2)?.click?.();
  await Bun.sleep(0);
  expect(f.errors).toEqual(["Error: Cannot reach GitHub"]);
  expect(f.state().stops).toBe(0);
});

test("late busy and update notifications cannot recreate a tray after Astra starts quitting", () => {
  const f = fixture();
  f.actions.updateVoice(f.snapshot());
  f.context.quitting = true;
  f.context.tray = null;
  expect(() => f.busy(true)).not.toThrow();
  expect(() => f.update({ status: "ready", version: "0.6.1" })).not.toThrow();
  expect(f.context.tray).toBeNull();
});
