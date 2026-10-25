import type { AudioHostCommand, AudioHostMessage } from "./live-media";
import { WebAudio } from "./web-audio";

declare global {
  interface Window {
    astraAudio: {
      subscribe: (callback: (command: AudioHostCommand) => void) => void;
      reply: (message: AudioHostMessage) => void;
    };
  }
}
const bridge = window.astraAudio;
const audio = new WebAudio(
  async () => {},
  (level) => bridge.reply({ event: { method: "voice/level", level } }),
  (error) =>
    bridge.reply({ event: { method: "voice/error", message: error.message } }),
  (error) => {
    if (error)
      bridge.reply({ event: { method: "voice/error", message: error } });
  },
  (pcm) => bridge.reply({ pcm: Array.from(pcm) }),
);
const callId = crypto.randomUUID();
let captureId = "";
bridge.subscribe((command) => {
  if (command.type === "frame") {
    try {
      audio.appendFrame(new Float32Array(command.pcm), command.start);
    } catch (error) {
      bridge.reply({
        event: { method: "voice/error", message: String(error) },
      });
    }
    return;
  }
  void (async () => {
    try {
      let result: string | null = null;
      if (command.action === "prepare") captureId = await audio.prepare(true);
      else if (command.action === "capture") captureId = await audio.prepare();
      else if (command.action === "inspect")
        result = JSON.stringify(await audio.diagnostics());
      else if (command.action === "offer")
        result = await audio.command({
          kind: "audio",
          action: "offer",
          callId,
          captureId,
          replayFrom: command.replayFrom,
        });
      else if (command.action === "answer" && command.sdp)
        await audio.command({
          kind: "audio",
          action: "answer",
          callId,
          captureId,
          sdp: command.sdp,
        });
      else if (command.action === "mute" && typeof command.muted === "boolean")
        await audio.command({
          kind: "audio",
          action: "mute",
          callId,
          captureId,
          muted: command.muted,
        });
      else throw new Error("Invalid audio command.");
      bridge.reply({ id: command.id, result });
    } catch (error) {
      bridge.reply({
        id: command.id,
        error:
          error instanceof DOMException && error.name === "NotAllowedError"
            ? "Microphone access denied. Allow microphone access in your system settings, then restart voice."
            : String(error),
      });
    }
  })();
});
window.addEventListener("pagehide", () => audio.stop());
