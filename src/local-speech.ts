import { PHONE_SAMPLE_RATE } from "./phone-audio";
import { isAstraAddress, isHomeShortcut, type SpeechEvent } from "./voice";
import type { DecodedSpeech, SpeechDecoder } from "./vosk";

const MAX_PCM_FRAME_SAMPLES = PHONE_SAMPLE_RATE;
const MAX_PENDING_SECONDS = 2;
const MAX_PENDING_SAMPLES = PHONE_SAMPLE_RATE * MAX_PENDING_SECONDS;
const UTTERANCE_SILENCE_SECONDS = 0.6;
const UTTERANCE_SILENCE_SAMPLES = PHONE_SAMPLE_RATE * UTTERANCE_SILENCE_SECONDS;
const WAKE_WORD_GAP_SAMPLES = PHONE_SAMPLE_RATE / 10;
const MIN_VOICE_RMS = 0.003;
const VOICE_LEVEL_SCALE = 8;
const MAX_LOCAL_TEXT = 1024;
const WAKE_WORD = "astra";
type Options = {
  language: () => "en" | "fr";
  onWakeAudioStart: (sample: number) => void;
};
type Run = {
  decoder: SpeechDecoder;
  homeOnly: boolean;
  awake: boolean;
  pending: number;
  base: number | null;
  next: number;
  sequence: Promise<unknown>;
  quiet: number;
  activity: boolean;
  utterance: boolean;
  utteranceStart: number | null;
  committed: string[];
  partial: string;
  lastRaw: string;
  published: string;
  rejectHome: boolean;
  recovering: boolean;
};

export class LocalSpeech {
  private run: Run | null = null;
  private generation = 0;

  constructor(
    private createDecoder: () => Promise<SpeechDecoder>,
    private onEvent: (event: SpeechEvent) => void,
    private options: Options,
  ) {}

  async start(_standby = true, homeOnly = false) {
    this.stop();
    const generation = this.generation;
    const decoder = await this.createDecoder();
    if (this.generation !== generation) {
      await decoder.close();
      return;
    }
    this.run = {
      decoder,
      homeOnly,
      awake: false,
      pending: 0,
      base: null,
      next: 0,
      sequence: Promise.resolve(),
      quiet: 0,
      activity: false,
      utterance: false,
      utteranceStart: null,
      committed: [],
      partial: "",
      lastRaw: "",
      published: "",
      rejectHome: false,
      recovering: false,
    };
  }

  async appendAudio(pcm: string, startSample?: number) {
    const data = Buffer.from(pcm, "base64");
    const bytesPerSample = Float32Array.BYTES_PER_ELEMENT;
    if (
      !data.length ||
      data.length % bytesPerSample ||
      data.length > MAX_PCM_FRAME_SAMPLES * bytesPerSample
    )
      throw new Error(
        "PCM must contain at most one second of mono Float32 audio.",
      );
    const samples = new Float32Array(data.length / bytesPerSample);
    for (let index = 0; index < samples.length; index++)
      samples[index] = data.readFloatLE(index * bytesPerSample);
    return this.appendFrame(samples, startSample);
  }

  async appendFrame(samples: Float32Array, startSample = this.run?.next ?? 0) {
    if (!samples.length || samples.length > MAX_PCM_FRAME_SAMPLES)
      throw new Error("PCM must contain at most one second of audio.");
    if (!Number.isSafeInteger(startSample) || startSample < 0)
      throw new Error("PCM requires a valid starting sample.");
    for (const sample of samples)
      if (!Number.isFinite(sample))
        throw new Error("PCM samples must be finite.");
    const run = this.run;
    if (!run) return false;
    if (run.pending + samples.length > MAX_PENDING_SAMPLES)
      return this.fail(
        run,
        new Error("Local recognition fell behind. Restart voice."),
      );
    const discontinuous = run.base !== null && startSample !== run.next;
    run.base ??= startSample;
    run.next = startSample + samples.length;
    run.pending += samples.length;
    const frame = samples.slice();
    const operation = run.sequence.then(async () => {
      try {
        if (this.run !== run) return false;
        if (discontinuous) {
          await run.decoder.close();
          if (this.run !== run) return false;
          const decoder = await this.createDecoder();
          if (this.run !== run) {
            await decoder.close();
            return false;
          }
          run.decoder = decoder;
          run.base = startSample;
          run.committed = [];
          run.partial = "";
          run.lastRaw = "";
          run.activity = false;
          run.utterance = false;
          run.utteranceStart = null;
          run.quiet = 0;
          run.rejectHome = true;
          run.recovering = true;
          this.publish(run, "");
        }
        const result = await run.decoder.accept(frame);
        if (this.run !== run) return false;
        await this.received(run, result, frame, startSample);
        return this.run === run;
      } catch (error) {
        return this.fail(run, error);
      } finally {
        run.pending -= frame.length;
      }
    });
    run.sequence = operation;
    return operation;
  }

  private update(run: Run, result: DecodedSpeech) {
    if (result.final) {
      if (result.text) run.committed.push(result.text);
      run.partial = "";
    } else run.partial = result.text;
    const text = [...run.committed, run.partial].filter(Boolean).join(" ");
    if (text.length > MAX_LOCAL_TEXT) {
      run.rejectHome = true;
      run.committed = [text.slice(-MAX_LOCAL_TEXT)];
      run.partial = "";
    }
    this.publish(run, text.slice(-MAX_LOCAL_TEXT));
    const wake = result.words.find(
      (word) => word.word.toLowerCase() === WAKE_WORD,
    );
    if (!run.homeOnly && !run.awake && !run.recovering && wake) {
      run.awake = true;
      const keywordStart =
        (run.base ?? 0) + Math.round(wake.start * PHONE_SAMPLE_RATE);
      this.options.onWakeAudioStart(
        Math.min(run.utteranceStart ?? keywordStart, keywordStart),
      );
      this.onEvent({ method: "voice/wake" });
    }
    return text;
  }

  private publish(run: Run, text: string) {
    if (run.published === text) return;
    run.published = text;
    this.onEvent({
      method: "voice/shortcut",
      text,
      language: this.options.language(),
    });
  }

  private async received(
    run: Run,
    result: DecodedSpeech,
    frame: Float32Array,
    startSample: number,
  ) {
    let energy = 0;
    for (const sample of frame) energy += sample * sample;
    const rms = Math.sqrt(energy / frame.length);
    this.onEvent({
      method: "voice/level",
      level: Math.min(1, rms * VOICE_LEVEL_SCALE),
    });
    if (rms >= MIN_VOICE_RMS) {
      run.utteranceStart ??= startSample;
      run.quiet = 0;
      run.activity = true;
      run.utterance = true;
    } else run.quiet += frame.length;
    if (result.text) {
      run.utterance = true;
      if (!run.activity && result.text !== run.lastRaw) run.quiet = 0;
    }
    run.lastRaw = result.text;
    this.update(run, result);
    if (this.run !== run) return;
    if (
      !run.homeOnly &&
      !run.awake &&
      !run.recovering &&
      result.text.split(/\s+/).includes(WAKE_WORD) &&
      (run.quiet >= WAKE_WORD_GAP_SAMPLES ||
        result.text.trim().startsWith(`${WAKE_WORD} `))
    ) {
      const confirmed = await run.decoder.finish();
      if (this.run !== run) return;
      this.update(run, confirmed);
    }
    if (!run.utterance || run.quiet < UTTERANCE_SILENCE_SAMPLES) return;
    const completed = await run.decoder.finish();
    if (this.run !== run) return;
    const text = this.update(run, completed);
    if (!run.rejectHome && isHomeShortcut(text))
      this.onEvent({ method: "voice/home" });
    else if (!run.rejectHome && run.homeOnly && isAstraAddress(text))
      this.onEvent({ method: "voice/address" });
    else if (run.awake) this.onEvent({ method: "voice/final", text: "" });
    run.committed = [];
    run.partial = "";
    run.lastRaw = "";
    run.activity = false;
    run.utterance = false;
    run.utteranceStart = null;
    run.rejectHome = false;
    run.recovering = false;
    this.publish(run, "");
  }

  private fail(run: Run, error: unknown) {
    if (this.run !== run) return false;
    this.stop();
    this.onEvent({
      method: "voice/error",
      message: `Local speech recognition failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return false;
  }

  stop() {
    this.generation++;
    const run = this.run;
    this.run = null;
    if (run)
      void run.decoder.close().catch((error) =>
        this.onEvent({
          method: "voice/error",
          message: `Could not release local recognition: ${String(error)}`,
        }),
      );
  }
}
