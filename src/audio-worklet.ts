import { PcmFramer } from "./phone-audio";

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
