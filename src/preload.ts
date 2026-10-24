import { contextBridge, ipcRenderer } from "electron";
import type { Bridge, Snapshot } from "./types";
import type { VoiceState } from "./voice";

const invoke = (name: string, ...args: unknown[]) =>
  ipcRenderer.invoke(`codexos:${name}`, ...args);
const bridge: Bridge = {
  remoteActive: () => invoke("remoteActive"),
  subscribeRemoteActive: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, active: boolean) =>
      callback(active);
    ipcRenderer.on("codexos:remoteActive", listener);
    return () => ipcRenderer.removeListener("codexos:remoteActive", listener);
  },
  voiceSnapshot: () => invoke("voiceSnapshot"),
  startVoice: (standby) => invoke("startVoice", standby),
  stopVoice: () => invoke("stopVoice"),
  interruptVoice: () => invoke("interruptVoice"),
  subscribeVoice: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: VoiceState) =>
      callback(state);
    ipcRenderer.on("codexos:voice", listener);
    return () => ipcRenderer.removeListener("codexos:voice", listener);
  },
  runAppleScript: (workspaceId, request) =>
    invoke("runAppleScript", workspaceId, request),
  snapshot: () => invoke("snapshot"),
  subscribe: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: Snapshot) =>
      callback(snapshot);
    ipcRenderer.on("codexos:snapshot", listener);
    return () => ipcRenderer.removeListener("codexos:snapshot", listener);
  },
  send: (text, workspaceId) => invoke("send", text, workspaceId),
  sendAssistant: (text) => invoke("sendAssistant", text),
  interrupt: (workspaceId) => invoke("interrupt", workspaceId),
  newWorkspace: () => invoke("newWorkspace"),
  selectWorkspace: (id) => invoke("selectWorkspace", id),
  setFavorite: (id, favorite) => invoke("setFavorite", id, favorite),
  renameWorkspace: (id, name) => invoke("renameWorkspace", id, name),
  deleteWorkspace: (id) => invoke("deleteWorkspace", id),
  chooseFolder: () => invoke("chooseFolder"),
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
contextBridge.exposeInMainWorld("codexos", bridge);
