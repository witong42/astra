import { expect, test } from "bun:test";
import { type AudioFrame, LocalInput } from "../src/local-input";
import type { SpeechEvent } from "../src/voice";
import type { SpeechDecoder } from "../src/vosk";

test("wake capture survives the recognition-to-live handoff and supplies one continuous prefix", async () => {
  let append!: (frame: Float32Array) => void;
  let starts = 0;
  let stops = 0;
  let decoded = 0;
  const events: SpeechEvent[] = [];
  const heard: AudioFrame[] = [];
  const input = new LocalInput(
    {
      start: async (onFrame) => {
        starts++;
        append = onFrame;
      },
      stop: () => {
        stops++;
      },
    },
    async () => ({
      accept: async () =>
        ++decoded === 4
          ? {
              text: "astra",
              final: true,
              words: [{ word: "astra", start: 0.3, end: 0.4 }],
            }
          : { text: "", final: false, words: [] },
      finish: async () => ({ text: "", final: true, words: [] }),
      close: async () => {},
    }),
    () => "fr",
    (open) => {
      let release = () => {};
      return {
        replaysWakeAudio: true,
        offer: async (replay) => {
          release = await open(Boolean(replay), (frame) => heard.push(frame));
          return "offer";
        },
        answer: async () => {},
        muteOutput: async () => {},
        stop: () => release(),
      };
    },
  );
  const wake = input.input.speech((event) => events.push(event));
  await wake.start(true);
  for (let i = 1; i <= 4; i++) append(new Float32Array(1600).fill(i / 10));
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(events.filter((event) => event.method === "voice/wake")).toHaveLength(
    1,
  );
  const media = input.input.media(() => {});
  await media.offer(true);
  expect(heard.map((frame) => frame.start)).toEqual([0]);
  expect(heard[0].pcm.length).toBe(6400);
  wake.stop();
  expect(starts).toBe(1);
  expect(stops).toBe(0);
  append(new Float32Array(1600).fill(0.5));
  expect(heard.map((frame) => frame.start)).toEqual([0, 6400]);
  media.stop();
  expect(stops).toBe(1);
  append(new Float32Array(1600));
  expect(heard).toHaveLength(2);
});

test("stopping a recognizer during model preparation never opens a late microphone", async () => {
  let resolve!: (decoder: SpeechDecoder) => void;
  let starts = 0;
  let closes = 0;
  const source = new LocalInput(
    {
      start: async () => {
        starts++;
      },
      stop() {},
    },
    () =>
      new Promise((done) => {
        resolve = done;
      }),
    () => "fr",
    () => {
      throw new Error("Not used");
    },
  );
  const wake = source.input.speech(() => {});
  const opening = wake.start(true);
  wake.stop();
  resolve({
    accept: async () => ({ text: "", final: false, words: [] }),
    finish: async () => ({ text: "", final: true, words: [] }),
    close: async () => {
      closes++;
    },
  });
  await opening;
  expect(starts).toBe(0);
  expect(closes).toBe(1);
});
