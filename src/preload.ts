import { contextBridge, ipcRenderer } from "electron";
import type { Bridge, Snapshot } from "./types";

const invoke = (name: string, ...args: unknown[]) =>
  ipcRenderer.invoke(`codexos:${name}`, ...args);
const bridge: Bridge = {
  snapshot: () => invoke("snapshot"),
  subscribe: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: Snapshot) =>
      callback(snapshot);
    ipcRenderer.on("codexos:snapshot", listener);
    return () => ipcRenderer.removeListener("codexos:snapshot", listener);
  },
  send: (text) => invoke("send", text),
  interrupt: () => invoke("interrupt"),
  newWorkspace: () => invoke("newWorkspace"),
  selectWorkspace: (id) => invoke("selectWorkspace", id),
  chooseFolder: () => invoke("chooseFolder"),
  setModel: (model) => invoke("setModel", model),
  updateData: (workspaceId, path, value) =>
    invoke("updateData", workspaceId, path, value),
  setReasoningEffort: (effort) => invoke("setReasoningEffort", effort),
  setServiceTier: (tier) => invoke("setServiceTier", tier),
  updateCanvas: (id, ack) => invoke("updateCanvas", id, ack),
  restoreCanvas: (index) => invoke("restoreCanvas", index),
  answer: (allow, answers) => invoke("answer", allow, answers),
  reconnect: () => invoke("reconnect"),
};
contextBridge.exposeInMainWorld("codexos", bridge);
