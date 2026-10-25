import type { AudioHost, CreateAudioHost } from "./live-media";
import type { SpeechEvent } from "./voice";

const CAPTURE_TIMEOUT_MS = 30_000;
const CAPTURE_REQUEST_ID = 1;

export class RendererAudio {
  private host: AudioHost | null = null;
  private generation = 0;
  private cancel: (() => void) | null = null;
  constructor(private createHost: CreateAudioHost) {}

  async start(
    onFrame: (pcm: Float32Array) => void,
    onEvent: (event: SpeechEvent) => void,
  ) {
    this.stop();
    const generation = this.generation;
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const ready = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    // Host creation can finish after stop; handle cancellation before awaiting it.
    void ready.catch(() => {});
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            "Microphone capture timed out. Check microphone access and restart voice.",
          ),
        ),
      CAPTURE_TIMEOUT_MS,
    );
    this.cancel = () => reject(new Error("Microphone capture stopped."));
    try {
      const host = await this.createHost((message) => {
        if (generation !== this.generation) return;
        if ("pcm" in message) onFrame(Float32Array.from(message.pcm));
        else if ("event" in message) {
          if (message.event.method === "voice/error")
            reject(new Error(message.event.message));
          onEvent(message.event);
        } else if (message.id === CAPTURE_REQUEST_ID) {
          if (message.error) reject(new Error(message.error));
          else resolve();
        }
      });
      if (generation !== this.generation) {
        host.close();
        throw new Error("Microphone capture stopped.");
      }
      this.host = host;
      host.send({ type: "request", id: CAPTURE_REQUEST_ID, action: "capture" });
      await ready;
    } catch (error) {
      if (generation === this.generation) this.stop();
      throw error;
    } finally {
      clearTimeout(timer);
      if (generation === this.generation) this.cancel = null;
    }
  }

  stop() {
    this.generation++;
    this.cancel?.();
    this.cancel = null;
    this.host?.close();
    this.host = null;
  }
}
