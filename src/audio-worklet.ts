import { PcmPlayback } from "./pcm-buffer";
import { PcmFramer, PHONE_SAMPLE_RATE } from "./phone-audio";

declare const sampleRate: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor,
): void;

class PhoneAudioProcessor extends AudioWorkletProcessor {
  private framer = new PcmFramer(sampleRate);
  process(inputs: Float32Array[][]) {
    const samples = inputs[0]?.[0];
    if (samples)
      for (const frame of this.framer.push(samples)) {
        let energy = 0;
        for (const sample of frame) energy += sample * sample;
        this.port.postMessage(
          {
            pcm: frame,
            level: Math.min(1, Math.sqrt(energy / frame.length) * 8),
          },
          [frame.buffer as ArrayBuffer],
        );
      }
    return true;
  }
}
registerProcessor("astra-phone-audio", PhoneAudioProcessor);

const MAX_BUFFERED_SECONDS = 30;
const BUFFER_REPORT_SAMPLES = PHONE_SAMPLE_RATE / 2;
class BufferedAudioProcessor extends AudioWorkletProcessor {
  private playback = new PcmPlayback(PHONE_SAMPLE_RATE * MAX_BUFFERED_SECONDS);
  private failed = false;
  private processedSamples = 0;
  constructor() {
    super();
    this.port.onmessage = (
      event: MessageEvent<{ type: string; pcm?: Float32Array }>,
    ) => {
      if (this.failed) return;
      try {
        if (event.data.type === "start") this.playback.start();
        else if (event.data.type === "pcm" && event.data.pcm)
          this.playback.append(event.data.pcm);
      } catch (error) {
        this.failed = true;
        this.port.postMessage({ error: String(error) });
      }
    };
  }
  process(_inputs: Float32Array[][], outputs: Float32Array[][]) {
    const output = outputs[0]?.[0];
    if (output) {
      this.playback.render(output);
      this.processedSamples += output.length;
      if (this.processedSamples >= BUFFER_REPORT_SAMPLES) {
        this.processedSamples = 0;
        this.port.postMessage({
          bufferedSamples: this.playback.bufferedSamples,
          playbackRate: this.playback.playbackRate,
        });
      }
    }
    return !this.failed;
  }
}
registerProcessor("astra-buffered-audio", BufferedAudioProcessor);
