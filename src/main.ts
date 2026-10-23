import { existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  shell,
} from "electron";
import { z } from "zod";
import { CodexBackend } from "./backend";
import { canvasAckSchema } from "./canvas";
import { externalWebUrl } from "./navigation";
import { loadState, saveState } from "./storage";
import type { SavedState, Snapshot } from "./types";
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
let latest: Snapshot | null = null;
let saved: SavedState | null = null;
let broadcastTimer: ReturnType<typeof setTimeout> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let quitting = false;

app.setName("CodexOS");
app.setPath("userData", DATA_DIRECTORY);
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  window?.show();
  window?.focus();
});

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
  latest = snapshot;
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    if (window && !window.isDestroyed())
      window.webContents.send("codexos:snapshot", latest);
  }, SNAPSHOT_INTERVAL_MS);
}

function installHandlers() {
  const handle = (name: string, callback: (...args: unknown[]) => unknown) => {
    ipcMain.handle(`codexos:${name}`, (event, ...args: unknown[]) => {
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame
      )
        throw new Error("This request did not come from the CodexOS window.");
      return callback(...args);
    });
  };
  handle("snapshot", () => backend.snapshot());
  handle("send", (text, workspaceId) =>
    backend.send(
      z.string().max(24_000).parse(text),
      z.string().uuid().optional().parse(workspaceId),
    ),
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
  handle("deleteWorkspace", async (id) => {
    const workspaceId = z.string().uuid().parse(id);
    const workspace = backend.state.workspaces.find(
      (entry) => entry.id === workspaceId,
    );
    if (!workspace || !window) throw new Error("This app no longer exists.");
    if (backend.snapshot().sessions[workspaceId]?.busy)
      throw new Error("Stop this app's current response before deleting it.");
    const result = await dialog.showMessageBox(window, {
      type: "warning",
      buttons: ["Delete App", "Cancel"],
      defaultId: 1,
      cancelId: 1,
      message: `Delete ${workspace.name}?`,
      detail:
        "Permanently removes this app's conversation, canvas, saved versions, and Codex thread history. This cannot be undone. Project files and external backups are kept.",
    });
    if (result.response !== 0) return false;
    try {
      await window.webContents.session.clearCache();
    } catch {
      throw new Error(
        "Cached files could not be cleared. Restart CodexOS and retry deletion. The app has been kept.",
      );
    }
    await backend.deleteWorkspace(workspaceId);
    return true;
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
  handle("chooseFolder", async () => {
    if (!window) return;
    const selected = await dialog.showOpenDialog(window, {
      title: "Choose a workspace folder",
      defaultPath: backend.workspace.cwd,
      properties: ["openDirectory"],
    });
    if (!selected.canceled && selected.filePaths[0])
      backend.createWorkspace(selected.filePaths[0]);
  });
}

async function flushRenderer() {
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
    dialog.showErrorBox(
      "The latest canvas edit could not be saved",
      String(error),
    );
  } finally {
    if (timer) clearTimeout(timer);
  }
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
    title: "CodexOS",
    titleBarStyle: "hiddenInset",
    trafficLightPosition: { x: 18, y: 21 },
    backgroundColor: "#f5f5f2",
    show: false,
    webPreferences: {
      preload: join(bundleDirectory, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
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
    void flushRenderer().finally(() => window?.destroy());
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
    backend = new CodexBackend(state, broadcast, persist);
    installHandlers();
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        {
          label: "CodexOS",
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
    backend.connect().catch((error) => {
      backend.state.status = "offline";
      backend.state.error = String(error);
      broadcast(backend.snapshot());
    });
    app.on("activate", () => {
      if (!window)
        createWindow().catch((error) =>
          dialog.showErrorBox("CodexOS could not open", String(error)),
        );
    });
  })
  .catch((error) => {
    dialog.showErrorBox("CodexOS could not start", String(error));
    app.quit();
  });

app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  void flushRenderer()
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
