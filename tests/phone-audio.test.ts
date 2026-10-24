import { expect, test } from "bun:test";
import { PcmFramer, PHONE_SAMPLE_RATE } from "../src/phone-audio";

test("phone PCM preserves duration, order and sample values across hardware buffer boundaries", () => {
  const samples = Float32Array.from({ length: 48_000 }, (_, i) =>
    Math.sin(i / 100),
  );
  const whole = new PcmFramer(48_000)
    .push(samples)
    .flatMap((frame) => [...frame]);
  const framer = new PcmFramer(48_000);
  const chunked: number[] = [];
  for (let offset = 0; offset < samples.length; offset += 128)
    chunked.push(
      ...framer
        .push(samples.subarray(offset, offset + 128))
        .flatMap((frame) => [...frame]),
    );
  expect(whole).toHaveLength(PHONE_SAMPLE_RATE);
  expect(chunked).toEqual(whole);
  for (let index = 0; index < whole.length; index++)
    expect(whole[index]).toBeCloseTo(samples[index * 3], 6);
});

test("phone PCM interpolates non-integer rates and bounds invalid samples", () => {
  const frames = new PcmFramer(44_100).push(new Float32Array(44_100).fill(0.5));
  expect(frames).toHaveLength(10);
  expect(frames[9][1599]).toBe(0.5);
  const input = new Float32Array(1600).fill(Number.NaN);
  input[0] = 2;
  input[1] = -2;
  const [frame] = new PcmFramer(16_000).push(input);
  expect([...frame.slice(0, 3)]).toEqual([1, -1, 0]);
  expect(() => new PcmFramer(0)).toThrow("sample rate");
});
