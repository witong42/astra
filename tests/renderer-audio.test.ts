import { expect, test } from "bun:test";
import type { AudioHostCommand, AudioHostMessage } from "../src/live-media";
import { RendererAudio } from "../src/renderer-audio";

test("renderer microphone delivers PCM and releases its host on stop", async () => {
  let receive!: (message: AudioHostMessage) => void;
  let closed = 0;
  const frames: Float32Array[] = [];
  const audio = new RendererAudio(async (callback) => {
    receive = callback;
    return {
      send: (command: AudioHostCommand) => {
        if (command.type === "request") {
          expect(command.action).toBe("capture");
          receive({ id: command.id });
        }
      },
      close: () => closed++,
    };
  });
  await audio.start(
    (frame) => frames.push(frame),
    () => {},
  );
  receive({ pcm: [0.25, -0.5] });
  expect(Array.from(frames[0] ?? [])).toEqual([0.25, -0.5]);
  audio.stop();
  receive({ pcm: [1] });
  expect(frames).toHaveLength(1);
  expect(closed).toBe(1);
});

test("stopping before the microphone host opens cannot leave capture running", async () => {
  let open!: (host: { send: () => void; close: () => void }) => void;
  let closed = 0;
  let commands = 0;
  const audio = new RendererAudio(
    () =>
      new Promise((resolve) => {
        open = resolve;
      }),
  );
  const starting = audio.start(
    () => {},
    () => {},
  );
  audio.stop();
  open({ send: () => commands++, close: () => closed++ });
  await expect(starting).rejects.toThrow("stopped");
  expect(closed).toBe(1);
  expect(commands).toBe(0);
});

test("denied microphone access closes the host and reports an actionable error", async () => {
  let closed = 0;
  const audio = new RendererAudio(async (receive) => ({
    send: (command) => {
      if (command.type === "request")
        receive({
          id: command.id,
          error: "Microphone access denied. Enable Windows microphone access.",
        });
    },
    close: () => closed++,
  }));
  await expect(
    audio.start(
      () => {},
      () => {},
    ),
  ).rejects.toThrow("Enable Windows");
  expect(closed).toBe(1);
});
