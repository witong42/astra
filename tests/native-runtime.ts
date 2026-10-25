import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { LocalSpeech } from "../src/local-speech";
import { PHONE_FRAME_SAMPLES, PHONE_SAMPLE_RATE } from "../src/phone-audio";
import { loadLocalModel, voiceAssets } from "../src/vosk";

// Mac: bun tests/native-runtime.ts dist/voice tests/fixtures/voice
// Windows: bun tests/native-runtime.ts C:\Astra\voice tests/fixtures/voice
// The voice directory must contain libvosk.dll and both keyword models.
const CASES = {
  "en-astra": "wake",
  "fr-astra": "wake",
  "en-astra-phrase": "wake",
  "fr-astra-phrase": "wake",
  "fr-wake-question": "wake",
  "fr-wake-bebe": "wake",
  "fr-wake-middle": "wake",
  "fr-wake-end": "wake",
  "fr-wake-no-name": "none",
  "fr-wake-stars": "none",
  "en-home": "home",
  "fr-home": "home",
  "en-home-repeat": "home",
  "en-home-assistant": "none",
  "fr-home-assistant": "none",
  "en-go-home": "none",
  "fr-dis-home": "none",
  "en-homepage": "none",
  "fr-astronaute": "none",
  "en-astronaut": "none",
  "fr-homme": "none",
  "en-ordinary": "none",
  "fr-ordinary": "none",
  silence: "none",
};
const PCM16_BYTES = Int16Array.BYTES_PER_ELEMENT;
const QUIET_TAIL_FRAMES = 12;
function readWave(path: string) {
  const data = readFileSync(path);
  assert.equal(data.toString("ascii", 0, 4), "RIFF");
  assert.equal(data.toString("ascii", 8, 12), "WAVE");
  let pcm: Buffer | null = null;
  let formatVerified = false;
  for (let offset = 12; offset + 8 <= data.length; ) {
    const size = data.readUInt32LE(offset + 4);
    const name = data.toString("ascii", offset, offset + 4);
    if (name === "fmt ") {
      assert.equal(data.readUInt16LE(offset + 8), 1);
      assert.equal(data.readUInt16LE(offset + 10), 1);
      assert.equal(data.readUInt32LE(offset + 12), PHONE_SAMPLE_RATE);
      assert.equal(data.readUInt16LE(offset + 22), 16);
      formatVerified = true;
    }
    if (name === "data") pcm = data.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  assert.ok(formatVerified && pcm, `Expected mono PCM16 at 16 kHz: ${path}`);
  const samples = new Float32Array(pcm.length / PCM16_BYTES);
  for (let index = 0; index < samples.length; index++)
    samples[index] = pcm.readInt16LE(index * PCM16_BYTES) / 32768;
  return samples;
}
async function main() {
  const assets = voiceAssets(resolve(process.argv[2] ?? "dist/voice"));
  const fixtures = resolve(process.argv[3] ?? "tests/fixtures/voice");
  const model = await loadLocalModel(assets);
  let cases = 0;
  try {
    for (const [id, expected] of Object.entries(CASES)) {
      const audio = readWave(join(fixtures, `${id}.wav`));
      for (const homeOnly of [false, true]) {
        for (const leadingQuietFrames of [0, 10]) {
          const events: string[] = [];
          const starts: number[] = [];
          const speech = new LocalSpeech(
            () => model.createDecoder(),
            (event) => {
              if (event.method === "voice/shortcut")
                assert.equal(event.language, "fr");
              else if (event.method === "voice/error")
                throw new Error(event.message);
              else if (
                event.method === "voice/wake" ||
                event.method === "voice/home"
              )
                events.push(event.method);
            },
            {
              language: () => "fr",
              onWakeAudioStart: (sample) => starts.push(sample),
            },
          );
          try {
            await speech.start(true, homeOnly);
            const leadingSamples = leadingQuietFrames * PHONE_FRAME_SAMPLES;
            for (let index = 0; index < leadingQuietFrames; index++)
              await speech.appendFrame(new Float32Array(PHONE_FRAME_SAMPLES));
            for (
              let offset = 0;
              offset < audio.length;
              offset += PHONE_FRAME_SAMPLES
            )
              await speech.appendFrame(
                audio.subarray(offset, offset + PHONE_FRAME_SAMPLES),
                leadingSamples + offset,
              );
            for (let index = 0; index < QUIET_TAIL_FRAMES; index++)
              await speech.appendFrame(new Float32Array(PHONE_FRAME_SAMPLES));
            assert.deepEqual(
              events,
              expected === "home"
                ? ["voice/home"]
                : expected === "wake" && !homeOnly
                  ? ["voice/wake"]
                  : [],
              `${id} homeOnly=${homeOnly} leadingQuietFrames=${leadingQuietFrames}`,
            );
            assert.equal(
              starts.length,
              expected === "wake" && !homeOnly ? 1 : 0,
              id,
            );
            for (const start of starts)
              assert.ok(
                start >= 0 && start < leadingSamples + audio.length,
                `${id}: invalid wake audio position`,
              );
            cases++;
          } finally {
            speech.stop();
          }
        }
      }
    }
    const creating = model.createDecoder();
    const closing = model.close();
    await assert.rejects(creating, /released/);
    await closing;
    await assert.rejects(model.createDecoder(), /released/);
  } finally {
    await model.close();
  }
  console.log(
    JSON.stringify({
      passed: cases,
      platform: process.platform,
      architecture: process.arch,
      electron: process.versions.electron ?? null,
      assets: assets.directory,
    }),
  );
}
main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});
