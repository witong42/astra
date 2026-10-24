import { z } from "zod";
import type { RemoteCommand } from "./remote-server";
import type { SpeechEvent, VoiceInput } from "./voice";

type Recognizer = {
  start: (standby?: boolean, homeOnly?: boolean) => Promise<void>;
  stop: () => void;
  appendAudio: (pcm: string) => Promise<boolean>;
};
type Transport = {
  requestClient: (clientId: string, command: RemoteCommand) => Promise<unknown>;
  notifyClient: (clientId: string, command: RemoteCommand) => void;
};
const sdpSchema = z.string().min(1).max(200_000);

export class PhoneInput {
  readonly input: VoiceInput;
  private recognition: Recognizer | null = null;
  private disposed = false;
  constructor(
    readonly clientId: string,
    readonly captureId: string,
    private transport: Transport,
    createRecognition: (onEvent: (event: SpeechEvent) => void) => Recognizer,
  ) {
    this.input = {
      speech: (onEvent) => {
        const recognition = createRecognition(onEvent);
        this.recognition?.stop();
        this.recognition = recognition;
        return {
          start: (standby, homeOnly) => recognition.start(standby, homeOnly),
          stop: () => {
            recognition.stop();
            if (this.recognition === recognition) this.recognition = null;
          },
        };
      },
      media: () => {
        const callId = crypto.randomUUID();
        const command = (action: "offer" | "stop"): RemoteCommand => ({
          kind: "audio",
          captureId,
          callId,
          action,
        });
        return {
          offer: async () => {
            if (this.disposed)
              throw new Error("This phone microphone session has ended.");
            return sdpSchema.parse(
              await transport.requestClient(clientId, command("offer")),
            );
          },
          answer: async (sdp) => {
            await transport.requestClient(clientId, {
              kind: "audio",
              action: "answer",
              captureId,
              callId,
              sdp,
            });
          },
          muteOutput: async (muted) => {
            await transport.requestClient(clientId, {
              kind: "audio",
              action: "mute",
              captureId,
              callId,
              muted,
            });
          },
          stop: () => transport.notifyClient(clientId, command("stop")),
        };
      },
    };
  }
  async appendAudio(clientId: string, captureId: string, pcm: string) {
    if (
      this.disposed ||
      clientId !== this.clientId ||
      captureId !== this.captureId
    )
      throw new Error(
        "This phone no longer owns the microphone. Start voice again.",
      );
    return (await this.recognition?.appendAudio(pcm)) ?? false;
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.recognition?.stop();
    this.recognition = null;
    this.transport.notifyClient(this.clientId, {
      kind: "capture",
      action: "stop",
      captureId: this.captureId,
    });
  }
}
