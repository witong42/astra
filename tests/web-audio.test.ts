import { expect, test } from "bun:test";
import { PHONE_FRAME_SAMPLES } from "../src/phone-audio";
import { WebAudio } from "../src/web-audio";

test("remote audio reports blocked playback and can resume without stopping the microphone", async () => {
  const properties = [
    "navigator",
    "AudioContext",
    "AudioWorkletNode",
    "Audio",
    "RTCPeerConnection",
  ] as const;
  const originals = properties.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  let microphoneStopped = false;
  const track = {
    stop: () => {
      microphoneStopped = true;
    },
    addEventListener() {},
  };
  const node = {
    connect() {
      return this;
    },
    frequency: { value: 0 },
  };
  const players: Player[] = [];
  class Player {
    autoplay = false;
    muted = false;
    paused = true;
    readyState = 4;
    srcObject: unknown = null;
    blocked = false;
    constructor() {
      players.push(this);
    }
    setAttribute() {}
    async play() {
      if (this.blocked)
        throw new DOMException("Autoplay blocked", "NotAllowedError");
      this.paused = false;
    }
    pause() {
      this.paused = true;
    }
  }
  class Context {
    state = "running";
    destination = {};
    audioWorklet = { addModule: async () => {} };
    createMediaStreamDestination() {
      return { stream: { getTracks: () => [{ stop() {} }] } };
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
  class Processor {
    port = { onmessage: null, close() {} };
    connect() {
      return this;
    }
    disconnect() {}
  }
  let peer!: Peer;
  class Peer {
    connectionState = "connected";
    iceGatheringState = "complete";
    localDescription: unknown;
    listeners = new Map<string, (event: unknown) => void>();
    constructor() {
      peer = this;
    }
    addTrack() {}
    createDataChannel() {}
    addEventListener(name: string, callback: (event: unknown) => void) {
      this.listeners.set(name, callback);
    }
    async createOffer() {
      return { type: "offer", sdp: "test-offer" };
    }
    async setLocalDescription(value: unknown) {
      this.localDescription = value;
    }
    async setRemoteDescription() {}
    async getStats() {
      return new Map([
        [
          "audio",
          {
            type: "inbound-rtp",
            kind: "audio",
            bytesReceived: 8000,
            packetsReceived: 20,
            totalAudioEnergy: 0.25,
          },
        ],
      ]);
    }
    close() {
      this.connectionState = "closed";
    }
  }
  const mocks = {
    navigator: {
      mediaDevices: {
        getUserMedia: async () => ({
          getTracks: () => [track],
          getAudioTracks: () => [track],
        }),
      },
    },
    AudioContext: Context,
    AudioWorkletNode: Processor,
    Audio: Player,
    RTCPeerConnection: Peer,
  };
  for (const key of properties)
    Object.defineProperty(globalThis, key, {
      configurable: true,
      value: mocks[key],
    });
  const errors: Error[] = [];
  const playback: (string | null)[] = [];
  const audio = new WebAudio(
    async () => {},
    () => {},
    (error) => errors.push(error),
    (error) => playback.push(error),
  );
  try {
    const captureId = await audio.prepare();
    const callId = crypto.randomUUID();
    expect(players).toHaveLength(1);
    const player = players[0];
    await audio.command({ kind: "audio", action: "offer", captureId, callId });
    const remote = {
      getAudioTracks: () => [{ kind: "audio", readyState: "live" }],
    };
    player.blocked = true;
    peer.listeners.get("track")?.({ streams: [remote] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(player.srcObject).toBe(remote);
    expect(playback.at(-1)).toContain("Activer le son");
    expect(microphoneStopped).toBe(false);
    expect(errors).toEqual([]);
    player.blocked = false;
    await audio.resumeOutput();
    expect(player.paused).toBe(false);
    expect(playback.at(-1)).toBeNull();
    const status = await audio.diagnostics();
    expect(status.inbound?.bytes).toBe(8000);
    expect(status.inbound?.energy).toBe(0.25);
    await audio.command({
      kind: "audio",
      action: "mute",
      captureId,
      callId,
      muted: true,
    });
    expect(player.muted).toBe(true);
    player.blocked = true;
    peer.listeners.get("track")?.({ streams: [remote] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(playback.at(-1)).toContain("Activer le son");
    await audio.command({ kind: "audio", action: "stop", captureId, callId });
    expect(playback.at(-1)).toBeNull();
    expect(microphoneStopped).toBe(false);
    audio.stop();
    expect(player.paused).toBe(true);
    expect(player.srcObject).toBeNull();
    expect(microphoneStopped).toBe(true);
  } finally {
    audio.stop();
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test.each([4, 24])(
  "slow uploads keep recent audio and the microphone open (%i frames)",
  async (frameCount) => {
    const properties = [
      "navigator",
      "AudioContext",
      "AudioWorkletNode",
      "Audio",
    ] as const;
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
      createMediaStreamDestination() {
        return { stream: { getTracks: () => [{ stop() {} }] } };
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
    Object.defineProperty(globalThis, "Audio", {
      configurable: true,
      value: class {
        autoplay = false;
        srcObject: unknown = null;
        setAttribute() {}
        async play() {}
        pause() {}
      },
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
      for (let index = 0; index < frameCount; index++) {
        const sample = (index + 1) / 100;
        processor.port.onmessage?.({
          data: {
            pcm: new Float32Array(PHONE_FRAME_SAMPLES).fill(sample),
            level: sample,
          },
        });
      }
      expect(stopped).toBe(false);
      expect(errors).toEqual([]);
      expect((await audio.diagnostics()).localInput).toEqual({
        queuedMs: Math.min(frameCount - 1, 10) * 100,
        discardedMs: Math.max(0, frameCount - 11) * 100,
      });
      expect(packets).toHaveLength(1);
      finish();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(packets).toHaveLength(2);
      const bytes = Uint8Array.from(atob(packets[1]), (character) =>
        character.charCodeAt(0),
      );
      const samples = new Float32Array(bytes.buffer);
      const queuedFrames = Math.min(frameCount - 1, 10);
      expect(samples).toHaveLength(PHONE_FRAME_SAMPLES * queuedFrames);
      for (let index = 0; index < queuedFrames; index++)
        expect(samples[PHONE_FRAME_SAMPLES * index]).toBeCloseTo(
          (frameCount - queuedFrames + index + 1) / 100,
        );
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
  },
);
