export const PHONE_SAMPLE_RATE = 16_000;
export const PHONE_FRAME_SAMPLES = 1600;

export class PcmFramer {
  private index = -1;
  private next = 0;
  private previous = 0;
  private frame = new Float32Array(PHONE_FRAME_SAMPLES);
  private used = 0;
  private readonly ratio: number;
  constructor(inputRate: number) {
    if (!Number.isFinite(inputRate) || inputRate < 8000 || inputRate > 192_000)
      throw new Error("The phone microphone has an unsupported sample rate.");
    this.ratio = inputRate / PHONE_SAMPLE_RATE;
  }
  push(samples: Float32Array) {
    const frames: Float32Array[] = [];
    for (const value of samples) {
      const sample = Number.isFinite(value)
        ? Math.max(-1, Math.min(1, value))
        : 0;
      this.index++;
      while (this.next <= this.index) {
        const fraction = this.next - (this.index - 1);
        this.frame[this.used++] =
          this.previous + (sample - this.previous) * fraction;
        this.next += this.ratio;
        if (this.used === PHONE_FRAME_SAMPLES) {
          frames.push(this.frame);
          this.frame = new Float32Array(PHONE_FRAME_SAMPLES);
          this.used = 0;
        }
      }
      this.previous = sample;
    }
    return frames;
  }
}
