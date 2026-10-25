import { LocalSpeech } from "./local-speech";
import { PcmHistory } from "./pcm-buffer";
import { PHONE_SAMPLE_RATE } from "./phone-audio";
import type { LiveMedia, SpeechEvent, VoiceInput } from "./voice";
import type { SpeechDecoder } from "./vosk";

const HISTORY_SECONDS = 30;
export const WAKE_AUDIO_LEAD_SAMPLES = PHONE_SAMPLE_RATE / 5;
export type AudioFrame = { pcm: Float32Array; start: number };
export type OpenAudio = (
  replay: boolean,
  frame: (value: AudioFrame) => void,
) => Promise<() => void>;
type Capture = {
  start: (
    frame: (pcm: Float32Array) => void,
    event: (value: SpeechEvent) => void,
  ) => Promise<void>;
  stop: () => void;
};

export class LocalInput {
  readonly input: VoiceInput;
  private history = new PcmHistory(PHONE_SAMPLE_RATE * HISTORY_SECONDS);
  private wakeStart: number | null = null;
  private frames = new Set<(frame: AudioFrame) => void>();
  private events = new Set<(event: SpeechEvent) => void>();
  private references = 0;
  private opening: Promise<void> | null = null;
  constructor(
    private capture: Capture,
    createDecoder: () => Promise<SpeechDecoder>,
    language: () => "en" | "fr",
    createMedia: (
      open: OpenAudio,
      event: (value: SpeechEvent) => void,
    ) => LiveMedia,
  ) {
    this.input = {
      speech: (onEvent) => {
        const recognition = new LocalSpeech(createDecoder, onEvent, {
          language,
          onWakeAudioStart: (sample) => {
            this.wakeStart = sample;
          },
        });
        let release: (() => void) | null = null;
        let stopped = false;
        const frame = (value: AudioFrame) => {
          void recognition.appendFrame(value.pcm, value.start);
        };
        return {
          start: async (standby, homeOnly) => {
            await recognition.start(standby, homeOnly);
            if (stopped) {
              recognition.stop();
              return;
            }
            this.frames.add(frame);
            this.events.add(onEvent);
            const acquired = this.acquire();
            release = acquired;
            try {
              await this.opening;
            } catch (error) {
              acquired();
              release = null;
              this.frames.delete(frame);
              this.events.delete(onEvent);
              recognition.stop();
              throw error;
            }
          },
          stop: () => {
            stopped = true;
            this.frames.delete(frame);
            this.events.delete(onEvent);
            recognition.stop();
            release?.();
            release = null;
          },
        };
      },
      media: (onEvent) =>
        createMedia(
          (replay, onFrame) => this.openAudio(replay, onFrame, onEvent),
          onEvent,
        ),
    };
  }
  private acquire() {
    if (this.references++ === 0) {
      this.history = new PcmHistory(PHONE_SAMPLE_RATE * HISTORY_SECONDS);
      this.wakeStart = null;
      this.opening = this.capture.start(
        (pcm) => {
          const start = this.history.end;
          this.history.append(pcm);
          let energy = 0;
          for (const sample of pcm) energy += sample * sample;
          for (const listener of this.events)
            listener({
              method: "voice/level",
              level: Math.min(1, Math.sqrt(energy / pcm.length) * 8),
            });
          for (const listener of this.frames) listener({ pcm, start });
        },
        (event) => {
          for (const listener of this.events) listener(event);
        },
      );
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--this.references === 0) {
        this.capture.stop();
        this.opening = null;
        this.wakeStart = null;
      }
    };
  }
  private async openAudio(
    replay: boolean,
    onFrame: (frame: AudioFrame) => void,
    onEvent: (event: SpeechEvent) => void,
  ) {
    const release = this.acquire();
    try {
      await this.opening;
      const start =
        replay && this.wakeStart !== null
          ? Math.max(0, this.wakeStart - WAKE_AUDIO_LEAD_SAMPLES)
          : this.history.end;
      const pcm = this.history.read(start);
      if (pcm.length) onFrame({ pcm, start });
      this.frames.add(onFrame);
      this.events.add(onEvent);
      return () => {
        this.frames.delete(onFrame);
        this.events.delete(onEvent);
        release();
      };
    } catch (error) {
      release();
      throw error;
    }
  }
}
