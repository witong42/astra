import { contextBridge, ipcRenderer } from "electron";
import { readLanguage } from "./locale";
import type { Bridge, Snapshot } from "./types";
import type { UpdateState } from "./updates";
import type { VoiceState } from "./voice";

const invoke = (name: string, ...args: unknown[]) =>
  ipcRenderer.invoke(`astra:${name}`, ...args);
const bridge: Bridge = {
  updateSnapshot: () => invoke("updateSnapshot"),
  checkForUpdates: () => invoke("checkForUpdates"),
  installUpdate: () => invoke("installUpdate"),
  subscribeUpdates: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: UpdateState) =>
      callback(state);
    ipcRenderer.on("astra:update", listener);
    return () => ipcRenderer.removeListener("astra:update", listener);
  },
  remoteActive: () => invoke("remoteActive"),
  subscribeRemoteActive: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, active: boolean) =>
      callback(active);
    ipcRenderer.on("astra:remoteActive", listener);
    return () => ipcRenderer.removeListener("astra:remoteActive", listener);
  },
  voiceSnapshot: () => invoke("voiceSnapshot"),
  startVoice: (standby) => invoke("startVoice", standby),
  stopVoice: () => invoke("stopVoice"),
  pauseVoice: () => invoke("pauseVoice"),
  interruptVoice: () => invoke("interruptVoice"),
  subscribeVoice: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: VoiceState) =>
      callback(state);
    ipcRenderer.on("astra:voice", listener);
    return () => ipcRenderer.removeListener("astra:voice", listener);
  },
  runAppleScript: (workspaceId, request) =>
    invoke("runAppleScript", workspaceId, request),
  runPowerShell: (workspaceId, request) =>
    invoke("runPowerShell", workspaceId, request),
  runShellScript: (workspaceId, request) =>
    invoke("runShellScript", workspaceId, request),
  snapshot: () => invoke("snapshot"),
  subscribe: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: Snapshot) =>
      callback(snapshot);
    ipcRenderer.on("astra:snapshot", listener);
    return () => ipcRenderer.removeListener("astra:snapshot", listener);
  },
  send: (text, workspaceId) => invoke("send", text, workspaceId),
  sendAssistant: (text) => invoke("sendAssistant", text),
  interrupt: (workspaceId) => invoke("interrupt", workspaceId),
  newWorkspace: () => invoke("newWorkspace"),
  selectWorkspace: (id) => invoke("selectWorkspace", id),
  setFavorite: (id, favorite) => invoke("setFavorite", id, favorite),
  renameWorkspace: (id, name) => invoke("renameWorkspace", id, name),
  deleteWorkspace: (id) => invoke("deleteWorkspace", id, readLanguage()),
  chooseFolder: () => invoke("chooseFolder", readLanguage()),
  setModel: (model) => invoke("setModel", model),
  updateData: (workspaceId, path, value) =>
    invoke("updateData", workspaceId, path, value),
  setReasoningEffort: (effort) => invoke("setReasoningEffort", effort),
  setServiceTier: (tier) => invoke("setServiceTier", tier),
  updateCanvas: (id, ack) => invoke("updateCanvas", id, ack),
  updateOpenUI: (id, generation, state) =>
    invoke("updateOpenUI", id, generation, state),
  restoreCanvas: (index, workspaceId) =>
    invoke("restoreCanvas", index, workspaceId),
  answer: (allow, answers, workspaceId, approvalId) =>
    invoke("answer", allow, answers, workspaceId, approvalId),
  reconnect: () => invoke("reconnect"),
  openExternal: (url) => invoke("openExternal", url),
};
contextBridge.exposeInMainWorld("astra", bridge);
