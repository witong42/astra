import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { BrowserWindow, ipcMain } from "electron";
import { z } from "zod";
import type { AudioHostMessage, CreateAudioHost } from "./live-media";
import { PHONE_FRAME_SAMPLES } from "./phone-audio";

const messageSchema = z.union([
  z
    .object({
      pcm: z
        .array(z.number().finite().min(-1).max(1))
        .min(1)
        .max(PHONE_FRAME_SAMPLES),
    })
    .strict(),
  z
    .object({
      id: z.number().int().positive(),
      result: z.string().max(200_000).nullable().optional(),
      error: z.string().max(2000).optional(),
    })
    .strict(),
  z
    .object({
      event: z.discriminatedUnion("method", [
        z.object({
          method: z.literal("voice/error"),
          message: z.string().max(2000),
        }),
        z.object({
          method: z.literal("voice/level"),
          level: z.number().finite().min(0).max(1),
        }),
      ]),
    })
    .strict(),
]);
export function audioWindow(directory: string): CreateAudioHost {
  return async (onMessage) => {
    const host = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: join(directory, "audio-preload.cjs"),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
        autoplayPolicy: "no-user-gesture-required",
        partition: `astra-audio-${randomUUID()}`,
      },
    });
    const permissions = host.webContents.session;
    permissions.setPermissionCheckHandler(
      (contents, permission, _origin, details) =>
        contents === host.webContents &&
        permission === "media" &&
        details.mediaType === "audio",
    );
    permissions.setPermissionRequestHandler(
      (contents, permission, callback, details) =>
        callback(
          contents === host.webContents &&
            permission === "media" &&
            "mediaTypes" in details &&
            details.mediaTypes?.length === 1 &&
            details.mediaTypes[0] === "audio",
        ),
    );
    let closing = false;
    const received = (event: Electron.IpcMainEvent, value: unknown) => {
      if (event.sender !== host.webContents || closing) return;
      const message = messageSchema.safeParse(value);
      if (message.success) onMessage(message.data as AudioHostMessage);
      else
        onMessage({
          event: {
            method: "voice/error",
            message:
              "The audio renderer returned an invalid response. Restart voice.",
          },
        });
    };
    ipcMain.on("astra-audio:reply", received);
    host.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    host.webContents.on("will-navigate", (event) => event.preventDefault());
    host.webContents.on("render-process-gone", () => {
      if (!closing)
        onMessage({
          event: {
            method: "voice/error",
            message: "The audio renderer stopped. Restart voice.",
          },
        });
    });
    host.once("closed", () => {
      ipcMain.removeListener("astra-audio:reply", received);
      if (!closing)
        onMessage({
          event: {
            method: "voice/error",
            message: "The audio window closed. Restart voice.",
          },
        });
    });
    try {
      await host.loadFile(join(directory, "audio-host.html"));
    } catch (error) {
      closing = true;
      host.destroy();
      throw error;
    }
    return {
      send: (command) => {
        if (host.isDestroyed())
          throw new Error("The audio window is unavailable.");
        host.webContents.send("astra-audio:command", command);
      },
      close: () => {
        closing = true;
        if (!host.isDestroyed()) host.destroy();
      },
    };
  };
}
