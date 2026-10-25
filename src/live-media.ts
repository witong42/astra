import type { AudioFrame, OpenAudio } from "./local-input";
import type { AudioStatus } from "./types";
import type { SpeechEvent } from "./voice";

const REQUEST_TIMEOUT_MS = 30_000;
export type AudioHostCommand =
  | { type: "frame"; start: number; pcm: number[] }
  | {
      type: "request";
      id: number;
      action: "prepare" | "capture" | "offer" | "answer" | "mute" | "inspect";
      sdp?: string;
      muted?: boolean;
      replayFrom?: number;
    };
export type AudioHostMessage =
  | { pcm: number[] }
  | { id: number; result?: string | null; error?: string }
  | { event: SpeechEvent };
export type AudioHost = {
  send: (command: AudioHostCommand) => void;
  close: () => void;
};
export type CreateAudioHost = (
  message: (value: AudioHostMessage) => void,
) => Promise<AudioHost>;

export class BufferedLiveMedia {
  readonly replaysWakeAudio = true;
  private host: AudioHost | null = null;
  private release: (() => void) | null = null;
  private stopped = false;
  private nextId = 0;
  private pending = new Map<
    number,
    {
      resolve: (result: string | null) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private createHost: CreateAudioHost,
    private openAudio: OpenAudio,
    private onEvent: (event: SpeechEvent) => void,
  ) {}
  private receive = (message: AudioHostMessage) => {
    if (this.stopped) return;
    if ("pcm" in message) return;
    if ("event" in message) {
      this.onEvent(message.event);
      return;
    }
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.result ?? null);
  };
  private request(
    action: "prepare" | "offer" | "answer" | "mute" | "inspect",
    params: { sdp?: string; muted?: boolean; replayFrom?: number } = {},
  ) {
    const host = this.host;
    if (!host || this.stopped)
      return Promise.reject(new Error("Voice audio has stopped."));
    return new Promise<string | null>((resolve, reject) => {
      const id = ++this.nextId;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error(`Voice audio timed out during ${action}. Restart voice.`),
        );
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      try {
        host.send({ type: "request", id, action, ...params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  async offer(replay = false) {
    const host = await this.createHost(this.receive);
    if (this.stopped) {
      host.close();
      throw new Error("Voice audio has stopped.");
    }
    this.host = host;
    await this.request("prepare");
    let first: number | undefined;
    const release = await this.openAudio(
      replay,
      ({ pcm, start }: AudioFrame) => {
        if (this.stopped) return;
        first ??= start;
        host.send({ type: "frame", start, pcm: Array.from(pcm) });
      },
    );
    if (this.stopped) {
      release();
      throw new Error("Voice audio has stopped.");
    }
    this.release = release;
    const result = await this.request("offer", { replayFrom: first });
    if (!result)
      throw new Error("Voice audio did not create a connection offer.");
    return result;
  }
  async answer(sdp: string) {
    await this.request("answer", { sdp });
  }
  async muteOutput(muted: boolean) {
    await this.request("mute", { muted });
  }
  async diagnostics(): Promise<AudioStatus> {
    const result = await this.request("inspect");
    if (!result) throw new Error("Voice audio diagnostics are unavailable.");
    return JSON.parse(result);
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.release?.();
    this.release = null;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Voice audio has stopped."));
    }
    this.pending.clear();
    this.host?.close();
    this.host = null;
  }
}
