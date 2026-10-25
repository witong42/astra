import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
const handler = source.slice(
  source.indexOf('  handle("installUpdate",'),
  source.indexOf('  handle("startVoice",'),
);
if (!handler.includes('handle("installUpdate"'))
  throw new Error("The update handler was not found.");

function fixture(failure?: "prepare" | "save" | "launch" | "quit") {
  const calls: string[] = [];
  let status = "standby";
  const context = {
    installingUpdate: false,
    quitting: false,
    HIDDEN_TEST_WINDOW: false,
    remoteActive: false,
    process: { platform: "darwin", pid: 1234 },
    DATA_DIRECTORY: "/isolated/profile",
    UPDATES_DIRECTORY: "/isolated/profile/updates",
    saved: {},
    join: (...parts: string[]) => parts.join("/"),
    controlQueue: Promise.resolve(),
    voice: { snapshot: () => ({ active: status !== "idle", status }) },
    backend: { snapshot: () => ({ sessions: {} }) },
    app: {
      isPackaged: true,
      getAppPath: () => "/isolated/Astra.app",
      getPath: () => "/isolated/Astra",
      quit: () => calls.push("quit"),
    },
    updates: {
      prepared: () => ({ version: "0.6.1" }),
      installing: () => calls.push("retained"),
      installationFailed: async (error: Error) => {
        calls.push("failed");
        return error;
      },
    },
    prepareUpdateInstall: async () => {
      calls.push("prepare");
      if (failure === "prepare") throw new Error("Invalid update archive");
      if (failure === "quit") context.quitting = true;
      return {};
    },
    launchUpdateInstaller: async () => {
      calls.push("launch");
      if (failure === "launch") throw new Error("Installer could not start");
    },
    flushRenderer: async () => calls.push("flush"),
    saveState: () => {
      calls.push("save");
      if (failure === "save") throw new Error("Workspace could not be saved");
    },
    stopVoiceInput: () => {
      calls.push("stop");
      status = "idle";
    },
    startVoiceInput: async () => {
      calls.push("resume");
      status = "standby";
    },
  };
  const invoke = runInNewContext(
    "let callback; const handle=(_name,handler)=>{callback=handler};" +
      handler +
      "\ncallback",
    context,
  ) as () => Promise<void>;
  return { calls, context, invoke, voice: () => status };
}

test("installing stops wake listening and saves the current state before launching the updater", async () => {
  const f = fixture();
  await f.invoke();
  expect(f.calls).toContain("stop");
  expect(f.calls.indexOf("stop")).toBeLessThan(f.calls.indexOf("prepare"));
  expect(f.calls.indexOf("save")).toBeLessThan(f.calls.indexOf("launch"));
  expect(f.calls.at(-1)).toBe("quit");
});

test.each(["prepare", "save", "launch"] as const)(
  "a failed update %s leaves Astra open, restores standby, and clears the update lock",
  async (failure) => {
    const f = fixture(failure);
    await expect(f.invoke()).rejects.toThrow();
    expect(f.calls).not.toContain("quit");
    expect(f.context.installingUpdate).toBe(false);
    expect(f.voice()).toBe("standby");
    expect(f.calls).toContain("failed");
    expect(f.calls).toContain("resume");
  },
);

test("quitting during update preparation cannot launch an installer or restart the microphone", async () => {
  const f = fixture("quit");
  await expect(f.invoke()).rejects.toThrow();
  expect(f.calls).not.toContain("launch");
  expect(f.calls).not.toContain("resume");
});
