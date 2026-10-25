import { expect, test } from "bun:test";
import { LocalSpeech } from "../src/local-speech";
import type { SpeechEvent } from "../src/voice";
import type { DecodedSpeech, SpeechDecoder } from "../src/vosk";

function fixture(results: DecodedSpeech[], failWhenEmpty = false) {
  const events: SpeechEvent[] = [];
  const starts: number[] = [];
  let closed = false;
  const decoder: SpeechDecoder = {
    accept: async () => {
      const result = results.shift();
      if (!result && failWhenEmpty)
        throw new Error("Unexpected microphone frame");
      return result ?? { text: "", final: false, words: [] };
    },
    finish: async () => ({ text: "", final: true, words: [] }),
    close: async () => {
      closed = true;
    },
  };
  const speech = new LocalSpeech(
    async () => decoder,
    (event) => events.push(event),
    {
      language: () => "fr",
      onWakeAudioStart: (sample) => starts.push(sample),
    },
  );
  return { speech, events, starts, closed: () => closed };
}

async function quiet(speech: LocalSpeech) {
  for (let index = 0; index < 11; index++)
    await speech.appendFrame(new Float32Array(1600));
}

test("a wake word inside a sentence keeps the speech before Astra in the audio replay", async () => {
  const value = fixture([
    { text: "[unk]", final: false, words: [] },
    {
      text: "[unk] astra [unk]",
      final: true,
      words: [{ word: "astra", start: 0.1, end: 0.2 }],
    },
  ]);
  try {
    await value.speech.start(true);
    await value.speech.appendFrame(new Float32Array(1600).fill(0.1), 8000);
    await value.speech.appendFrame(new Float32Array(1600).fill(0.1), 9600);
    expect(value.starts).toEqual([8000]);
    expect(
      value.events.filter((event) => event.method === "voice/wake"),
    ).toHaveLength(1);
  } finally {
    value.speech.stop();
  }
});

test("Astra wakes once and identifies the beginning of its buffered audio", async () => {
  const value = fixture([
    {
      text: "astra",
      final: false,
      words: [{ word: "astra", start: 0.2, end: 0.6 }],
    },
    {
      text: "astra [unk]",
      final: false,
      words: [{ word: "astra", start: 0.2, end: 0.6 }],
    },
    {
      text: "astra [unk]",
      final: true,
      words: [{ word: "astra", start: 0.2, end: 0.6 }],
    },
  ]);
  await value.speech.start(true);
  for (const start of [8000, 24000, 40000])
    await value.speech.appendFrame(new Float32Array(16000), start);
  await quiet(value.speech);
  expect(
    value.events.filter((event) => event.method === "voice/wake"),
  ).toHaveLength(1);
  expect(value.starts).toEqual([11200]);
  expect(
    value.events.filter((event) => event.method === "voice/final"),
  ).toEqual([{ method: "voice/final", text: "" }]);
  value.speech.stop();
});

test("a Home partial followed by other speech never navigates Home", async () => {
  for (const text of ["home [unk]", "[unk] home", "[unk]", "home home"]) {
    const value = fixture([
      { text: "home", final: false, words: [] },
      { text, final: true, words: [] },
    ]);
    await value.speech.start(true, true);
    await value.speech.appendFrame(new Float32Array(1600).fill(0.1));
    await value.speech.appendFrame(new Float32Array(1600).fill(0.1));
    await quiet(value.speech);
    expect(
      value.events.filter((event) => event.method === "voice/home"),
    ).toHaveLength(text === "home home" ? 1 : 0);
    expect(
      value.events.filter((event) => event.method === "voice/wake"),
    ).toHaveLength(0);
    expect(
      value.events
        .filter((event) => event.method === "voice/shortcut")
        .every((event) => event.language === "fr"),
    ).toBe(true);
    value.speech.stop();
  }
});

test("Home completes within 600 ms of quiet while a shorter pause inside Home Assistant stays ordinary speech", async () => {
  const results: DecodedSpeech[] = [{ text: "home", final: false, words: [] }];
  const value = fixture(results);
  await value.speech.start(true, true);
  await value.speech.appendFrame(new Float32Array(1600).fill(0.1));
  for (let index = 0; index < 5; index++)
    await value.speech.appendFrame(new Float32Array(1600));
  expect(
    value.events.filter((event) => event.method === "voice/home"),
  ).toHaveLength(0);
  results.push({ text: "home [unk]", final: true, words: [] });
  await value.speech.appendFrame(new Float32Array(1600).fill(0.1));
  await quiet(value.speech);
  expect(
    value.events.filter((event) => event.method === "voice/home"),
  ).toHaveLength(0);
  results.push({ text: "home", final: true, words: [] });
  await value.speech.appendFrame(new Float32Array(1600).fill(0.1));
  for (let index = 0; index < 6; index++)
    await value.speech.appendFrame(new Float32Array(1600));
  expect(
    value.events.filter((event) => event.method === "voice/home"),
  ).toHaveLength(1);
  value.speech.stop();
});

test("standalone Astra is addressed locally after silence even during a live conversation", async () => {
  for (const text of ["astra", "astra [unk]"]) {
    const value = fixture([{ text, final: true, words: [] }]);
    await value.speech.start(true, true);
    await value.speech.appendFrame(new Float32Array(1600).fill(0.1));
    await quiet(value.speech);
    expect(
      value.events.filter((event) => event.method === "voice/address"),
    ).toHaveLength(text === "astra" ? 1 : 0);
    value.speech.stop();
  }
});

test("a dropped phone prefix cannot turn the tail of a sentence into standalone Home", async () => {
  const results = [
    { text: "[unk]", final: false, words: [] },
    { text: "home", final: true, words: [] },
  ];
  const value = fixture(results);
  await value.speech.start(true, true);
  await value.speech.appendFrame(new Float32Array(1600).fill(0.1), 0);
  await value.speech.appendFrame(new Float32Array(1600).fill(0.1), 16000);
  await quiet(value.speech);
  expect(
    value.events.filter((event) => event.method === "voice/home"),
  ).toHaveLength(0);
  results.push({ text: "home", final: true, words: [] });
  await value.speech.appendFrame(new Float32Array(1600).fill(0.1));
  await quiet(value.speech);
  expect(
    value.events.filter((event) => event.method === "voice/home"),
  ).toHaveLength(1);
  expect(
    value.events.filter((event) => event.method === "voice/error"),
  ).toHaveLength(0);
  value.speech.stop();
});

test("a result completed after stopping cannot trigger Home", async () => {
  let resolve!: (result: DecodedSpeech) => void;
  let closed = false;
  const events: SpeechEvent[] = [];
  const decoder: SpeechDecoder = {
    accept: () =>
      new Promise((done) => {
        resolve = done;
      }),
    finish: async () => ({ text: "", final: true, words: [] }),
    close: async () => {
      closed = true;
    },
  };
  const speech = new LocalSpeech(
    async () => decoder,
    (event) => events.push(event),
    { language: () => "fr", onWakeAudioStart: () => {} },
  );
  await speech.start(true, true);
  const pending = speech.appendFrame(new Float32Array(1600), 0);
  await Promise.resolve();
  speech.stop();
  resolve({ text: "home", final: true, words: [] });
  expect(await pending).toBe(false);
  expect(events.filter((event) => event.method === "voice/home")).toHaveLength(
    0,
  );
  expect(closed).toBe(true);
});

test("malformed phone PCM is rejected before native recognition", async () => {
  const value = fixture([]);
  await value.speech.start(true);
  await expect(
    value.speech.appendAudio(Buffer.from([1, 2, 3]).toString("base64")),
  ).rejects.toThrow("PCM");
  const invalid = new Float32Array([Number.NaN]);
  await expect(
    value.speech.appendAudio(Buffer.from(invalid.buffer).toString("base64")),
  ).rejects.toThrow("finite");
  expect(value.events).toEqual([]);
  value.speech.stop();
});

test("a failed decoder reports an actionable error and stops recognition", async () => {
  const value = fixture([], true);
  await value.speech.start(true, true);
  expect(await value.speech.appendFrame(new Float32Array(1600), 0)).toBe(false);
  expect(
    value.events.some(
      (event) =>
        event.method === "voice/error" &&
        event.message.includes("Unexpected microphone frame"),
    ),
  ).toBe(true);
  expect(value.closed()).toBe(true);
});

test("a decoder endpoint cannot turn Home into a command while the user continues speaking", async () => {
  const value = fixture([
    {
      text: "home",
      final: true,
      words: [{ word: "home", start: 0, end: 0.4 }],
    },
    { text: "[unk]", final: true, words: [] },
  ]);
  await value.speech.start(true, true);
  await value.speech.appendFrame(new Float32Array(1600).fill(0.1));
  expect(
    value.events.filter((event) => event.method === "voice/home"),
  ).toHaveLength(0);
  await quiet(value.speech);
  expect(
    value.events.filter((event) => event.method === "voice/home"),
  ).toHaveLength(0);
  await value.speech.appendFrame(new Float32Array(1600).fill(0.1));
  expect(
    value.events.filter((event) => event.method === "voice/home"),
  ).toHaveLength(0);
  value.speech.stop();
});

test("an untimed Astra partial is confirmed before its audio prefix is selected", async () => {
  const events: SpeechEvent[] = [];
  const starts: number[] = [];
  let confirmations = 0;
  const decoder = {
    accept: async () => ({ text: "astra", final: false, words: [] }),
    finish: async () => {
      confirmations++;
      return {
        text: "astra",
        final: true,
        words: [{ word: "astra", start: 0.05, end: 0.2 }],
      };
    },
    close: async () => {},
  };
  const speech = new LocalSpeech(
    async () => decoder,
    (event) => events.push(event),
    { language: () => "fr", onWakeAudioStart: (sample) => starts.push(sample) },
  );
  await speech.start(true);
  for (let index = 0; index < 4; index++)
    await speech.appendFrame(
      new Float32Array(1600).fill(index < 2 ? 0.1 : 0),
      4000 + index * 1600,
    );
  expect(confirmations).toBe(1);
  expect(starts).toEqual([4000]);
  expect(events.filter((event) => event.method === "voice/wake")).toHaveLength(
    1,
  );
  speech.stop();
});
