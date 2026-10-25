import { expect, test } from "bun:test";
import {
  type AudioHostCommand,
  type AudioHostMessage,
  BufferedLiveMedia,
} from "../src/live-media";
import type { AudioFrame } from "../src/local-input";

test("buffered media sends the prefix and ongoing audio once, then releases capture and its isolated host", async () => {
  const commands: AudioHostCommand[] = [];
  let receive!: (message: AudioHostMessage) => void;
  let append!: (frame: AudioFrame) => void;
  let closed = false;
  let released = false;
  const media = new BufferedLiveMedia(
    async (listener) => {
      receive = listener;
      return {
        send: (command) => {
          commands.push(command);
          if (command.type === "request")
            queueMicrotask(() =>
              receive({
                id: command.id,
                result: command.action === "offer" ? "buffered-offer" : null,
              }),
            );
        },
        close: () => {
          closed = true;
        },
      };
    },
    async (replay, frame) => {
      expect(replay).toBe(true);
      append = frame;
      frame({ start: 100, pcm: new Float32Array([0.1, 0.2]) });
      return () => {
        released = true;
      };
    },
    () => {},
  );
  expect(media.replaysWakeAudio).toBe(true);
  expect(await media.offer(true)).toBe("buffered-offer");
  append({ start: 102, pcm: new Float32Array([0.3]) });
  await media.answer("remote-answer");
  await media.muteOutput(true);
  expect(
    commands
      .filter((command) => command.type === "frame")
      .map((command) => command.start),
  ).toEqual([100, 102]);
  expect(
    commands.find(
      (command) => command.type === "request" && command.action === "offer",
    ),
  ).toMatchObject({ replayFrom: 100 });
  media.stop();
  media.stop();
  expect(closed && released).toBe(true);
  const count = commands.length;
  append({ start: 103, pcm: new Float32Array([0.4]) });
  expect(commands).toHaveLength(count);
  await expect(media.answer("stale")).rejects.toThrow("stopped");
});

test("stopping during host creation closes the late window without opening the microphone", async () => {
  let finish!: (host: { send: () => void; close: () => void }) => void;
  let closed = false;
  let captures = 0;
  const media = new BufferedLiveMedia(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
    async () => {
      captures++;
      return () => {};
    },
    () => {},
  );
  const opening = media.offer();
  media.stop();
  finish({
    send() {},
    close: () => {
      closed = true;
    },
  });
  await expect(opening).rejects.toThrow("stopped");
  expect(closed).toBe(true);
  expect(captures).toBe(0);
});
