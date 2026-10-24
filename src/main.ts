import { existsSync, mkdirSync, statSync } from "node:fs";
import type { Server } from "node:net";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
  Tray,
} from "electron";
import { z } from "zod";
import type { AppController } from "./app-control";
import { runAppleScript } from "./applescript";
import { astraSocketPath, startAstraApi } from "./astra-api";
import { CodexBackend, findCodex } from "./backend";
import { canvasAckSchema } from "./canvas";
import { CodexLiveMedia } from "./live-media";
import {
  INTERFACE_LANGUAGES,
  type InterfaceLanguage,
  messages,
} from "./locale";
import { NativeSpeech } from "./native-speech";
import { externalWebUrl } from "./navigation";
import { PhoneInput } from "./phone-input";
import { readRemoteConfig } from "./remote-config";
import { type RemoteMethod, startRemoteServer } from "./remote-server";
import { loadState, saveState } from "./storage";
import type { SavedState, Snapshot } from "./types";
import { APP_BUILD, APP_VERSION } from "./version";
import { VoiceSession, type VoiceState } from "./voice";
import { appNameSchema } from "./workspace-name";

declare const __PROJECT_ROOT__: string;
const DATA_DIRECTORY =
  process.env.CODEXOS_DATA_DIR ??
  join(homedir(), "Library/Application Support/CodexOS");
const SNAPSHOT_INTERVAL_MS = 40;
const SAVE_INTERVAL_MS = 300;
const FLUSH_TIMEOUT_MS = 5000;
const HIDDEN_TEST_WINDOW =
  process.env.CODEXOS_TEST_HIDDEN === "1" &&
  Boolean(process.env.CODEXOS_DATA_DIR);
let window: BrowserWindow | null = null;
let backend: CodexBackend;
let voice: VoiceSession;
let tray: Tray | null = null;
let trayStatus = "";
let latest: Snapshot | null = null;
let saved: SavedState | null = null;
let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let quitting = false;
let api: Server | null = null;
let controlQueue = Promise.resolve<unknown>(undefined);
let remote: Awaited<ReturnType<typeof startRemoteServer>> | null = null;
let phoneInput: PhoneInput | null = null;
let voiceTransfer = 0;
let changingVoice = 0;
let remoteActive = false;
let desktopVoiceWasActive = false;
const methods = new Map<string, (...args: unknown[]) => unknown>();
const PERSISTENCE_METHODS = new Set([
  "updateData",
  "updateCanvas",
  "updateOpenUI",
]);
const PASSIVE_METHODS = new Set([
  "snapshot",
  "voiceSnapshot",
  "remoteActive",
  ...PERSISTENCE_METHODS,
]);
const controlInterface: AppController = (request) => {
  const operation = controlQueue.then(async () => {
    const clientId = remote?.activeClient() ?? phoneInput?.clientId;
    if (clientId && remote)
      return remote.requestClient(clientId, { kind: "interface", request });
    if (!window || window.isDestroyed())
      throw new Error("Astra's window is unavailable.");
    if (request.action !== "status" && !HIDDEN_TEST_WINDOW) await showWindow();
    const result = await window.webContents.executeJavaScript(
      `(()=>{if(!window.astraControl)throw new Error("Astra's interface is still opening.");return window.astraControl(${JSON.stringify(request)});})()`,
    );
    return request.action === "status"
      ? {
          ...result,
          windowVisible: window.isVisible(),
          voice: voice.snapshot().status,
          homeShortcut: voice.shortcutDiagnostics(),
        }
      : result;
  });
  controlQueue = operation.catch(() => {});
  return operation;
};

app.setName("Astra");
app.setPath("userData", DATA_DIRECTORY);
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => void showWindow());

function persist(state: SavedState, immediate = false) {
  if (immediate) {
    saveState(join(DATA_DIRECTORY, "workspace.json"), state);
    saved = state;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    return;
  }
  saved = state;
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      if (saved) saveState(join(DATA_DIRECTORY, "workspace.json"), saved);
    } catch (error) {
      if (backend) {
        backend.state.error =
          error instanceof Error ? error.message : String(error);
        broadcast(backend.snapshot());
      }
    }
  }, SAVE_INTERVAL_MS);
}

function broadcast(snapshot: Snapshot) {
  voice?.observe(snapshot);
  latest = snapshot;
  remote?.publishSnapshot(snapshot);
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    if (window && !window.isDestroyed())
      window.webContents.send("codexos:snapshot", latest);
  }, SNAPSHOT_INTERVAL_MS);
}

function installHandlers() {
  const handle = (name: string, callback: (...args: unknown[]) => unknown) => {
    methods.set(name, callback);
    ipcMain.handle(`codexos:${name}`, (event, ...args: unknown[]) => {
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error("This request did not come from the Astra window.");
      if (remoteActive && PERSISTENCE_METHODS.has(name)) return;
      if (remoteActive && !PASSIVE_METHODS.has(name))
        throw new Error(
          "Astra is active on the phone. Close its browser tab to resume here.",
        );
      if (!PASSIVE_METHODS.has(name)) {
        if (phoneInput && name !== "startVoice" && name !== "stopVoice")
          stopVoiceInput();
      }
      return callback(...args);
    });
  };
  handle("voiceSnapshot", () => voice.snapshot());
  handle("remoteActive", () => remoteActive);
  handle("startVoice", async (standby) => {
    await startVoiceInput(z.boolean().optional().parse(standby) ?? false, null);
  });
  handle("stopVoice", () => {
    stopVoiceInput();
    backend.setVoiceEnabled(false);
  });
  handle("interruptVoice", () => voice.interrupt());
  handle("snapshot", () => backend.snapshot());
  handle("runAppleScript", (workspaceId, request) => {
    const id = z.string().uuid().parse(workspaceId);
    if (
      id !== backend.state.activeId ||
      !backend.state.workspaces.some((entry) => entry.id === id)
    )
      throw new Error(
        "AppleScript actions must come from the active mini-app.",
      );
    return runAppleScript(request);
  });
  handle("send", (text, workspaceId) =>
    backend.send(
      z.string().max(24_000).parse(text),
      z.string().uuid().optional().parse(workspaceId),
    ),
  );
  handle("sendAssistant", (text) =>
    backend.sendAssistant(z.string().max(24_000).parse(text)),
  );
  handle("interrupt", (workspaceId) =>
    backend.interrupt(z.string().uuid().optional().parse(workspaceId)),
  );
  handle("newWorkspace", () => backend.createWorkspace());
  handle("selectWorkspace", (id) =>
    backend.selectWorkspace(z.string().uuid().parse(id)),
  );
  handle("setFavorite", (id, favorite) =>
    backend.setFavorite(
      z.string().uuid().parse(id),
      z.boolean().parse(favorite),
    ),
  );
  handle("renameWorkspace", (id, name) =>
    backend.renameWorkspace(
      z.string().uuid().parse(id),
      appNameSchema.parse(name),
    ),
  );
  handle("deleteWorkspace", (id, language) =>
    deleteWorkspace(
      id,
      false,
      z.enum(INTERFACE_LANGUAGES).optional().parse(language),
    ),
  );
  async function deleteWorkspace(
    id: unknown,
    confirmed: boolean,
    language: InterfaceLanguage = "fr",
  ) {
    const t = messages[language];
    const workspaceId = z.string().uuid().parse(id);
    const workspace = backend.state.workspaces.find(
      (entry) => entry.id === workspaceId,
    );
    if (!workspace || !window) throw new Error("This app no longer exists.");
    if (backend.snapshot().sessions[workspaceId]?.busy)
      throw new Error("Stop this app's current response before deleting it.");
    const result = confirmed
      ? { response: 0 }
      : await dialog.showMessageBox(window, {
          type: "warning",
          buttons: [t.deleteApp, t.cancel],
          defaultId: 1,
          cancelId: 1,
          message: t.deleteTitle,
          detail: `${workspace.name}\n\n${t.deleteConfirm}`,
        });
    if (result.response !== 0) return false;
    try {
      await window.webContents.session.clearCache();
    } catch {
      throw new Error(
        "Cached files could not be cleared. Restart Astra and retry deletion. The app has been kept.",
      );
    }
    await backend.deleteWorkspace(workspaceId);
    return true;
  }
  methods.set("remoteDeleteWorkspace", (id, confirmed) => {
    if (confirmed !== true)
      throw new Error(
        "Confirm deletion on the phone before deleting this app.",
      );
    return deleteWorkspace(id, true);
  });
  handle("setModel", (model) =>
    backend.setModel(z.string().max(200).parse(model)),
  );
  handle("updateData", (workspaceId, path, value) =>
    backend.updateData(
      z.string().uuid().parse(workspaceId),
      z.string().startsWith("/").max(300).parse(path),
      value,
    ),
  );
  handle("setReasoningEffort", (effort) =>
    backend.setReasoningEffort(z.string().max(100).parse(effort)),
  );
  handle("setServiceTier", (tier) =>
    backend.setServiceTier(z.string().max(100).parse(tier)),
  );
  handle("updateCanvas", (id, ack) =>
    backend.updateCanvas(
      z.string().uuid().parse(id),
      canvasAckSchema.parse(ack),
    ),
  );
  handle("restoreCanvas", (index, workspaceId) =>
    backend.restoreCanvas(
      z.number().int().nonnegative().parse(index),
      z.string().uuid().optional().parse(workspaceId),
    ),
  );
  handle("updateOpenUI", (id, generation, state) =>
    backend.updateOpenUI(
      z.string().uuid().parse(id),
      z.number().int().nonnegative().parse(generation),
      state,
    ),
  );
  handle("answer", (allow, answers, workspaceId, approvalId) =>
    backend.answer(
      z.boolean().parse(allow),
      answers === undefined
        ? undefined
        : z.record(z.string(), z.string().max(8_000)).parse(answers),
      z.string().uuid().optional().parse(workspaceId),
      z
        .union([z.string().max(300), z.number().int()])
        .optional()
        .parse(approvalId),
    ),
  );
  handle("reconnect", () => backend.connect());
  handle("openExternal", (url) => shell.openExternal(externalWebUrl(url)));
  handle("chooseFolder", async (language) => {
    const t =
      messages[z.enum(INTERFACE_LANGUAGES).optional().parse(language) ?? "fr"];
    if (!window) return;
    const selected = await dialog.showOpenDialog(window, {
      title: t.chooseFolder,
      defaultPath: backend.workspace.cwd,
      properties: ["openDirectory"],
    });
    if (!selected.canceled && selected.filePaths[0])
      backend.createWorkspace(selected.filePaths[0]);
  });
}

async function flushRenderer(strict = false) {
  if (!window || window.isDestroyed() || window.webContents.isDestroyed())
    return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      window.webContents.executeJavaScript("window.codexosFlush?.()"),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("The canvas did not respond before closing.")),
          FLUSH_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    if (strict) throw error;
    dialog.showErrorBox(
      "The latest canvas edit could not be saved",
      String(error),
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function showWindow() {
  try {
    if (!window) await createWindow();
    window?.show();
    window?.focus();
  } catch (error) {
    dialog.showErrorBox("Astra could not open", String(error));
  }
}
function releasePhoneInput() {
  const source = phoneInput;
  phoneInput = null;
  source?.dispose();
}
function setRemoteActive(active: boolean) {
  remoteActive = active;
  if (window && !window.isDestroyed())
    window.webContents.send("codexos:remoteActive", active);
}
function stopVoiceInput() {
  voiceTransfer++;
  changingVoice = 0;
  voice.stop();
  releasePhoneInput();
}
async function startVoiceInput(standby: boolean, source: PhoneInput | null) {
  const transfer = ++voiceTransfer;
  changingVoice = transfer;
  releasePhoneInput();
  phoneInput = source;
  try {
    await voice.start(standby, source?.input ?? null);
    if (transfer === voiceTransfer && voice.snapshot().active)
      backend.setVoiceEnabled(true);
  } finally {
    if (changingVoice === transfer) {
      changingVoice = 0;
      if (!voice.snapshot().active) releasePhoneInput();
    }
  }
}
async function invokeRemote(
  method: RemoteMethod,
  args: unknown[],
  clientId: string,
) {
  if (quitting && !PASSIVE_METHODS.has(method))
    throw new Error("Astra is closing on the Mac.");
  if (method === "startVoice") {
    const { captureId, standby } = z
      .object({
        captureId: z.string().uuid(),
        standby: z.boolean().default(false),
      })
      .strict()
      .parse(args[0]);
    if (!remote) throw new Error("Remote access is unavailable.");
    const input = new PhoneInput(
      clientId,
      captureId,
      remote,
      (onEvent) =>
        new NativeSpeech(
          join(app.getAppPath(), "dist/voice-helper"),
          onEvent,
          "phone",
        ),
    );
    return startVoiceInput(standby, input);
  }
  if (method === "voiceAudio") {
    const { captureId, pcm } = z
      .object({
        captureId: z.string().uuid(),
        pcm: z.string().min(4).max(85_336),
      })
      .strict()
      .parse(args[0]);
    if (!phoneInput)
      throw new Error("Start the phone microphone before sending audio.");
    return phoneInput.appendAudio(clientId, captureId, pcm);
  }
  if (method === "stopVoice" && args[0] !== undefined) {
    const { captureId } = z
      .object({ captureId: z.string().uuid() })
      .strict()
      .parse(args[0]);
    if (
      !phoneInput ||
      phoneInput.clientId !== clientId ||
      phoneInput.captureId !== captureId
    )
      return;
  }
  if (method === "chooseFolder") {
    const path = z.string().min(1).max(4096).parse(args[0]);
    if (!isAbsolute(path) || !existsSync(path) || !statSync(path).isDirectory())
      throw new Error("Enter an existing absolute folder path on the Mac.");
    return backend.createWorkspace(path);
  }
  const name = method === "deleteWorkspace" ? "remoteDeleteWorkspace" : method;
  const callback = methods.get(name);
  if (!callback) throw new Error("This Astra action is unavailable remotely.");
  return callback(...args);
}
function updateVoice(state: VoiceState) {
  if (!state.active && !changingVoice) releasePhoneInput();
  if (state.active || !changingVoice)
    remote?.publishVoice(state, phoneInput?.clientId ?? null);
  if (window && !window.isDestroyed())
    window.webContents.send("codexos:voice", state);
  if (state.status === trayStatus) return;
  trayStatus = state.status;
  if (!tray) {
    tray = new Tray(
      nativeImage
        .createFromPath(join(app.getAppPath(), "dist/icon.png"))
        .resize({ width: 18, height: 18 }),
    );
    tray.on("click", () => void showWindow());
  }
  const label =
    state.status === "standby"
      ? "Say Astra · Dites Astra"
      : state.status === "off"
        ? "Microphone paused"
        : state.status === "error"
          ? "Voice unavailable"
          : state.status;
  tray.setToolTip(`Astra · ${label}`);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: `Astra · ${label}`, enabled: false },
      { label: "Open Astra", click: () => void showWindow() },
      { type: "separator" },
      {
        label: state.active ? "Pause microphone" : "Enable voice",
        click: () => {
          if (voice.snapshot().active) {
            stopVoiceInput();
            backend.setVoiceEnabled(false);
          } else
            void startVoiceInput(true, null)
              .then(() => backend.setVoiceEnabled(voice.snapshot().active))
              .catch((error) =>
                dialog.showErrorBox(
                  "Astra voice could not start",
                  String(error),
                ),
              );
        },
      },
      {
        label: "Interrupt",
        enabled: state.status === "thinking" || state.status === "speaking",
        click: () =>
          void voice
            .interrupt()
            .catch((error) =>
              dialog.showErrorBox("Astra could not interrupt", String(error)),
            ),
      },
      { type: "separator" },
      { role: "quit" },
    ]),
  );
}

async function createWindow() {
  const bundleDirectory = join(app.getAppPath(), "dist");
  app.dock?.setIcon(
    nativeImage.createFromPath(join(bundleDirectory, "icon.png")),
  );
  window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 650,
    title: "Astra",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 21 },
    backgroundColor: "#090a10",
    show: false,
    webPreferences: {
      preload: join(bundleDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-frame-navigate", (event) => {
    if (event.url !== pathToFileURL(join(bundleDirectory, "canvas.html")).href)
      event.preventDefault();
  });
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    void flushRenderer().finally(() => window?.hide());
  });
  window.on("closed", () => {
    window = null;
  });
  window.once("ready-to-show", () => {
    if (!HIDDEN_TEST_WINDOW) window?.show();
  });
  await window.loadURL(pathToFileURL(join(bundleDirectory, "index.html")).href);
}

app
  .whenReady()
  .then(async () => {
    if (HIDDEN_TEST_WINDOW) app.dock?.hide();
    mkdirSync(DATA_DIRECTORY, { recursive: true, mode: 0o700 });
    const cwd = existsSync(__PROJECT_ROOT__) ? __PROJECT_ROOT__ : homedir();
    const state = loadState(join(DATA_DIRECTORY, "workspace.json"), cwd);
    backend = new CodexBackend(state, broadcast, persist, controlInterface);
    voice = new VoiceSession(
      backend,
      (onEvent) =>
        new NativeSpeech(join(app.getAppPath(), "dist/voice-helper"), onEvent),
      (onEvent) => new CodexLiveMedia(findCodex(), onEvent),
      updateVoice,
      () => controlInterface({ action: "home" }),
    );
    app.setAboutPanelOptions({
      applicationName: "Astra",
      applicationVersion: APP_VERSION,
      version: String(APP_BUILD),
      credits:
        "Mini-app icons: Solar by 480 Design. Colors and presentation adapted for Astra. CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/\nSource: https://www.figma.com/community/file/1166831539721848736",
    });
    installHandlers();
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "Astra",
          submenu: [
            { role: "about" },
            { type: "separator" },
            { role: "hide" },
            { role: "hideOthers" },
            { role: "unhide" },
            { type: "separator" },
            { role: "quit" },
          ],
        },
        {
          label: "Edit",
          submenu: [
            { role: "undo" },
            { role: "redo" },
            { type: "separator" },
            { role: "cut" },
            { role: "copy" },
            { role: "paste" },
            { role: "selectAll" },
          ],
        },
        {
          label: "View",
          submenu: [
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { role: "togglefullscreen" },
          ],
        },
        {
          label: "Window",
          submenu: [{ role: "minimize" }, { role: "zoom" }, { role: "front" }],
        },
      ]),
    );
    await createWindow();
    try {
      const config = readRemoteConfig(
        join(DATA_DIRECTORY, "remote-access.json"),
      );
      if (config) {
        remote = await startRemoteServer(config, {
          connecting: async () => {
            await flushRenderer(true);
            desktopVoiceWasActive = voice.snapshot().active;
            stopVoiceInput();
            setRemoteActive(true);
          },
          snapshot: () => backend.snapshot(),
          voice: () => ({
            state: voice.snapshot(),
            owner: phoneInput?.clientId ?? null,
          }),
          disconnected: (clientId) => {
            if (phoneInput?.clientId === clientId) stopVoiceInput();
            setRemoteActive(false);
            if (desktopVoiceWasActive && !quitting) {
              desktopVoiceWasActive = false;
              void startVoiceInput(true, null).catch((error) => {
                backend.state.error = String(error);
                broadcast(backend.snapshot());
              });
            }
          },
          invoke: invokeRemote,
        });
        remote.server.on("error", (error) => {
          backend.state.error = `Astra remote access failed: ${error.message}`;
          broadcast(backend.snapshot());
        });
      }
    } catch (error) {
      backend.state.error = String(error);
      broadcast(backend.snapshot());
    }
    api = await startAstraApi(astraSocketPath(DATA_DIRECTORY), (request) => {
      if (quitting)
        throw new Error("Astra is quitting. Retry after opening it again.");
      return backend.appAction(request);
    });
    api.on("error", (error) => {
      backend.state.error = `Astra's local API failed: ${error.message}`;
      broadcast(backend.snapshot());
    });
    updateVoice(voice.snapshot());
    if (state.voiceEnabled && !HIDDEN_TEST_WINDOW)
      void startVoiceInput(true, null).catch((error) => {
        backend.state.error = String(error);
        broadcast(backend.snapshot());
      });
    backend.connect().catch((error) => {
      backend.state.status = "offline";
      backend.state.error = String(error);
      broadcast(backend.snapshot());
    });
    app.on("activate", () => void showWindow());
  })
  .catch((error) => {
    dialog.showErrorBox("Astra could not start", String(error));
    app.quit();
  });

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  api?.close();
  if (voice) stopVoiceInput();
  tray?.destroy();
  tray = null;
  void controlQueue
    .then(async () => {
      await flushRenderer();
      try {
        await Promise.all(
          remote
            ?.clientIds()
            .map((id) => remote?.requestClient(id, { kind: "flush" })) ?? [],
        );
      } catch (error) {
        dialog.showErrorBox(
          "The latest phone edit could not be saved",
          String(error),
        );
      }
      await remote?.close();
    })
    .then(async () => {
      if (saveTimer) clearTimeout(saveTimer);
      if (saved) {
        try {
          saveState(join(DATA_DIRECTORY, "workspace.json"), saved);
        } catch (error) {
          dialog.showErrorBox("Workspace could not be saved", String(error));
        }
      }
      await backend?.stop();
    })
    .finally(() => app.quit());
});
process.on("SIGTERM", () => app.quit());
process.on("SIGINT", () => app.quit());
