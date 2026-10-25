import { PHONE_FRAME_SAMPLES } from "./phone-audio";

export class PcmHistory {
  private samples: Float32Array;
  private position: number;
  private origin: number;

  constructor(capacity: number, start = 0) {
    if (!Number.isSafeInteger(capacity) || capacity < 1)
      throw new Error("Audio history requires a positive sample capacity.");
    if (!Number.isSafeInteger(start) || start < 0)
      throw new Error("Audio history requires a valid starting sample.");
    this.position = start;
    this.origin = start;
    this.samples = new Float32Array(capacity);
  }

  get start() {
    return Math.max(this.origin, this.position - this.samples.length);
  }

  get end() {
    return this.position;
  }

  append(frame: Float32Array) {
    for (const sample of frame)
      if (!Number.isFinite(sample))
        throw new Error("Audio samples must be finite.");
    for (const sample of frame)
      this.samples[this.position++ % this.samples.length] = sample;
  }

  read(start: number, end = this.position) {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end
    )
      throw new Error("Invalid audio history range.");
    if (start < this.start)
      throw new Error(
        "The beginning of this voice request is no longer available.",
      );
    if (end > this.position)
      throw new Error("The requested audio has not been captured yet.");
    const result = new Float32Array(end - start);
    for (let index = start; index < end; index++)
      result[index - start] = this.samples[index % this.samples.length];
    return result;
  }
}

const MAX_CATCH_UP_RATE = 1.25;

export class PcmPlayback {
  private history: PcmHistory;
  private cursor = 0;
  private playing = false;
  private rate = 1;
  constructor(private capacity: number) {
    this.history = new PcmHistory(capacity);
  }
  append(frame: Float32Array) {
    if (this.history.end - this.cursor + frame.length > this.capacity)
      throw new Error("Voice connection fell behind. Restart voice.");
    this.history.append(frame);
  }
  start() {
    this.playing = true;
  }
  get bufferedSamples() {
    return this.history.end - this.cursor;
  }
  get playbackRate() {
    return this.rate;
  }
  render(output: Float32Array) {
    output.fill(0);
    if (!this.playing || !output.length) return;
    const excess = Math.max(
      0,
      this.bufferedSamples - PHONE_FRAME_SAMPLES - output.length,
    );
    this.rate = 1 + Math.min(MAX_CATCH_UP_RATE - 1, excess / output.length);
    const start = Math.floor(this.cursor);
    const end = Math.min(
      this.history.end,
      Math.ceil(this.cursor + output.length * this.rate) + 1,
    );
    const samples = this.history.read(start, end);
    for (let index = 0; index < output.length; index++) {
      if (this.cursor >= this.history.end) break;
      const position = this.cursor - start;
      const left = Math.floor(position);
      const right = Math.min(left + 1, samples.length - 1);
      const fraction = position - left;
      output[index] =
        samples[left] + (samples[right] - samples[left]) * fraction;
      this.cursor = Math.min(this.history.end, this.cursor + this.rate);
    }
  }
}
