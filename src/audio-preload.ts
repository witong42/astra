import { contextBridge, ipcRenderer } from "electron";
import type { AudioHostCommand, AudioHostMessage } from "./live-media";

contextBridge.exposeInMainWorld("astraAudio", {
  subscribe: (callback: (command: AudioHostCommand) => void) => {
    ipcRenderer.on("astra-audio:command", (_event, command: AudioHostCommand) =>
      callback(command),
    );
  },
  reply: (message: AudioHostMessage) =>
    ipcRenderer.send("astra-audio:reply", message),
});
