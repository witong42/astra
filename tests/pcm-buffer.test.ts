import { expect, test } from "bun:test";
import { PcmHistory, PcmPlayback } from "../src/pcm-buffer";

test("PCM history preserves the wake word across wrapped microphone frames", () => {
  const history = new PcmHistory(5);
  history.append(new Float32Array([1, 2, 3, 4]));
  history.append(new Float32Array([5, 6, 7]));
  expect(history.start).toBe(2);
  expect(history.end).toBe(7);
  expect([...history.read(2)]).toEqual([3, 4, 5, 6, 7]);
  expect([...history.read(3, 6)]).toEqual([4, 5, 6]);
});

test("expired or future audio is rejected instead of losing a request prefix", () => {
  const history = new PcmHistory(3);
  history.append(new Float32Array([1, 2, 3, 4]));
  expect(() => history.read(0)).toThrow("no longer available");
  expect(() => history.read(1, 5)).toThrow("not been captured");
  expect(() => history.read(3, 2)).toThrow("range");
});

test("audio snapshots remain independent of reused capture buffers", () => {
  const history = new PcmHistory(4);
  const frame = new Float32Array([1, 2]);
  history.append(frame);
  frame.fill(0);
  const snapshot = history.read(0);
  snapshot.fill(0);
  expect([...history.read(0)]).toEqual([1, 2]);
});

test("invalid audio cannot partially overwrite the history", () => {
  const history = new PcmHistory(4);
  history.append(new Float32Array([1]));
  expect(() => history.append(new Float32Array([2, Number.NaN]))).toThrow(
    "finite",
  );
  expect(history.end).toBe(1);
  expect([...history.read(0)]).toEqual([1]);
});

test("audio captured during negotiation and prefix playback arrives once in order", () => {
  const playback = new PcmPlayback(8);
  const output = new Float32Array(2);
  playback.append(new Float32Array([1, 2, 3]));
  playback.render(output);
  expect([...output]).toEqual([0, 0]);
  playback.append(new Float32Array([4, 5]));
  playback.start();
  playback.render(output);
  expect([...output]).toEqual([1, 2]);
  playback.append(new Float32Array([6, 7]));
  playback.render(output);
  expect([...output]).toEqual([3, 4]);
  playback.render(output);
  expect([...output]).toEqual([5, 6]);
  playback.render(output);
  expect([...output]).toEqual([7, 0]);
  playback.render(output);
  expect([...output]).toEqual([0, 0]);
  playback.append(new Float32Array([8]));
  playback.render(output);
  expect([...output]).toEqual([8, 0]);
});

test("buffer overflow fails instead of dropping the beginning of a request", () => {
  const playback = new PcmPlayback(2);
  playback.append(new Float32Array([1, 2]));
  expect(() => playback.append(new Float32Array([3]))).toThrow("fell behind");
});

test("connection backlog is caught up while microphone audio keeps arriving", () => {
  const sampleRate = 16_000;
  const frameSamples = sampleRate / 10;
  const playback = new PcmPlayback(sampleRate * 30);
  let captured = 0;
  const append = () => {
    const frame = Float32Array.from({ length: frameSamples }, () => ++captured);
    playback.append(frame);
  };
  for (let frame = 0; frame < 30; frame++) append();
  playback.start();
  const output = new Float32Array(frameSamples);
  let first = true;
  for (let frame = 0; frame < 150; frame++) {
    append();
    playback.render(output);
    if (first) expect(output[0]).toBe(1);
    first = false;
  }
  expect(captured - output[output.length - 1]).toBeLessThan(sampleRate / 4);
});

test("catch-up retains every buffered speech segment and returns to normal speed", () => {
  const sampleRate = 16_000;
  const frameSamples = sampleRate / 10;
  const playback = new PcmPlayback(sampleRate * 30);
  const segments = 30;
  for (let segment = 1; segment <= segments; segment++)
    playback.append(new Float32Array(frameSamples).fill(segment));
  playback.start();
  const heard = new Set<number>();
  const output = new Float32Array(frameSamples);
  for (let frame = 0; frame < 40; frame++) {
    playback.render(output);
    for (const sample of output)
      if (Number.isInteger(sample) && sample > 0) heard.add(sample);
  }
  expect([...heard]).toEqual(
    Array.from({ length: segments }, (_, index) => index + 1),
  );
  const current = Float32Array.from(
    { length: frameSamples },
    (_, index) => index + 1,
  );
  playback.append(current);
  playback.render(output);
  expect(output).toEqual(current);
});

test("phone history keeps absolute coordinates when capture starts before recognition", () => {
  const history = new PcmHistory(3, 100);
  history.append(new Float32Array([1, 2, 3, 4]));
  expect(history.start).toBe(101);
  expect(history.end).toBe(104);
  expect([...history.read(101)]).toEqual([2, 3, 4]);
});
