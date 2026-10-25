import { expect, test } from "bun:test";
import { PhoneInput } from "../src/phone-input";
import type { RemoteCommand } from "../src/remote-server";

test("phone capture survives live-call rotation, routes PCM to the current local recognizer and rejects stale owners", async () => {
  const commands: RemoteCommand[] = [];
  const frames: string[] = [];
  let stops = 0;
  const clientId = crypto.randomUUID();
  const captureId = crypto.randomUUID();
  const source = new PhoneInput(
    clientId,
    captureId,
    {
      requestClient: async (_id, command) => {
        commands.push(command);
        return command.kind === "audio" && command.action === "offer"
          ? "phone-offer"
          : null;
      },
      notifyClient: (_id, command) => {
        commands.push(command);
      },
    },
    () => ({
      start: async () => {},
      stop: () => {
        stops++;
      },
      appendAudio: async (pcm) => {
        frames.push(pcm);
        return true;
      },
    }),
  );
  const home = source.input.speech(() => {});
  await home.start(true, true);
  expect(await source.appendAudio(clientId, captureId, "frame")).toBe(true);
  await expect(
    source.appendAudio(crypto.randomUUID(), captureId, "bad"),
  ).rejects.toThrow("no longer owns");
  await expect(
    source.appendAudio(clientId, crypto.randomUUID(), "bad"),
  ).rejects.toThrow("no longer owns");
  const first = source.input.media(() => {});
  expect(await first.offer()).toBe("phone-offer");
  first.stop();
  expect(commands.some((command) => command.kind === "capture")).toBe(false);
  const second = source.input.media(() => {});
  await second.offer();
  const offers = commands.filter(
    (command) => command.kind === "audio" && command.action === "offer",
  );
  expect(offers).toHaveLength(2);
  expect(offers[0]).not.toEqual(offers[1]);
  home.stop();
  expect(await source.appendAudio(clientId, captureId, "ignored")).toBe(false);
  expect(frames).toEqual(["frame"]);
  expect(stops).toBe(1);
  source.dispose();
  source.dispose();
  expect(commands.filter((command) => command.kind === "capture")).toHaveLength(
    1,
  );
  await expect(second.offer()).rejects.toThrow("ended");
});

test("phone wake replay uses the browser's absolute audio position and never asks the Mac to capture", async () => {
  const commands: RemoteCommand[] = [];
  let markWake!: (sample: number) => void;
  const positions: (number | undefined)[] = [];
  const source = new PhoneInput(
    "client",
    "capture",
    {
      requestClient: async (_id, command) => {
        commands.push(command);
        return "offer";
      },
      notifyClient: (_id, command) => {
        commands.push(command);
      },
    },
    (_event, onWakeAudioStart) => {
      markWake = onWakeAudioStart;
      return {
        start: async () => {},
        stop() {},
        appendAudio: async (_pcm, startSample) => {
          positions.push(startSample);
          return true;
        },
      };
    },
  );
  const speech = source.input.speech(() => {});
  await speech.start(true);
  await source.appendAudio("client", "capture", "frame", 16000);
  markWake(20000);
  const media = source.input.media(() => {});
  expect(media.replaysWakeAudio).toBe(true);
  await media.offer(true);
  expect(positions).toEqual([16000]);
  expect(commands[0]).toMatchObject({
    kind: "audio",
    action: "offer",
    replayFrom: 16800,
  });
  source.dispose();
});
