import { expect, test } from "bun:test";
import { PHONE_FRAME_SAMPLES } from "../src/phone-audio";
import { WebAudio } from "../src/web-audio";

test("slow network uploads batch queued microphone frames without losing their order", async () => {
  const properties = ["navigator", "AudioContext", "AudioWorkletNode"] as const;
  const originals = properties.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  let stopped = false;
  const track = {
    stop: () => {
      stopped = true;
    },
    addEventListener() {},
  };
  const node = {
    connect() {
      return this;
    },
    frequency: { value: 0 },
    type: "",
  };
  class Context {
    state = "running";
    destination = {};
    audioWorklet = { addModule: async () => {} };
    createGain() {
      return node;
    }
    createMediaStreamSource() {
      return node;
    }
    createBiquadFilter() {
      return node;
    }
    async resume() {}
    async close() {}
    addEventListener() {}
  }
  let processor!: Processor;
  class Processor {
    port = {
      onmessage: null as
        | ((event: { data: { pcm: Float32Array; level: number } }) => void)
        | null,
      close() {},
    };
    constructor() {
      processor = this;
    }
    connect() {
      return this;
    }
    disconnect() {}
  }
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [track],
          getAudioTracks: () => [track],
        }),
      },
    },
  });
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    value: Context,
  });
  Object.defineProperty(globalThis, "AudioWorkletNode", {
    configurable: true,
    value: Processor,
  });
  const packets: string[] = [];
  const errors: Error[] = [];
  let finish!: () => void;
  const audio = new WebAudio(
    async (_id, pcm) => {
      packets.push(pcm);
      if (packets.length === 1)
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
    },
    () => {},
    (error) => {
      errors.push(error);
    },
  );
  try {
    const id = await audio.prepare();
    audio.enable(id);
    for (const sample of [0.1, 0.2, 0.3, 0.4])
      processor.port.onmessage?.({
        data: {
          pcm: new Float32Array(PHONE_FRAME_SAMPLES).fill(sample),
          level: sample,
        },
      });
    expect(packets).toHaveLength(1);
    finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(packets).toHaveLength(2);
    const bytes = Uint8Array.from(atob(packets[1]), (character) =>
      character.charCodeAt(0),
    );
    const samples = new Float32Array(bytes.buffer);
    expect(samples).toHaveLength(PHONE_FRAME_SAMPLES * 3);
    expect(samples[0]).toBeCloseTo(0.2);
    expect(samples[PHONE_FRAME_SAMPLES]).toBeCloseTo(0.3);
    expect(samples[PHONE_FRAME_SAMPLES * 2]).toBeCloseTo(0.4);
    expect(bytes.byteLength).toBeLessThanOrEqual(64_000);
    expect(errors).toEqual([]);
  } finally {
    audio.stop();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
  expect(stopped).toBe(true);
});
