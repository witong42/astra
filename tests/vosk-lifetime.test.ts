import { expect, mock, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROBE_ARGUMENT = "--vosk-lifetime-probe";
const MODEL_NEW = "vosk_model_new";
const RECOGNIZER_NEW = "vosk_recognizer_new_grm";
const ACCEPT = "vosk_recognizer_accept_waveform";
type NativeCallback = (error: Error | null, value: unknown) => void;
type Scenario = "creation" | "accept";

async function checkpoint() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function probe(scenario: Scenario) {
  const directory = mkdtempSync(join(tmpdir(), "astra-vosk-lifetime-"));
  const libraryPath = join(directory, "libvosk.dylib");
  const modelPath = join(directory, "model");
  mkdirSync(join(modelPath, "am"), { recursive: true });
  writeFileSync(libraryPath, "placeholder");
  writeFileSync(join(modelPath, "am/final.mdl"), "placeholder");
  const events: string[] = [];
  const violations: string[] = [];
  const callbacks = new Map<string, NativeCallback>();
  const live = new Set<string>();
  let loaded = true;

  function check(name: string) {
    if (!loaded) violations.push(`${name} used an unloaded library`);
    if (name.startsWith("vosk_recognizer_") && !live.has("model"))
      violations.push(`${name} used a released model`);
  }

  function complete(name: string, value: unknown) {
    const callback = callbacks.get(name);
    if (!callback) throw new Error(`No pending native call: ${name}`);
    check(name);
    callbacks.delete(name);
    if (name === MODEL_NEW) live.add("model");
    if (name === RECOGNIZER_NEW) live.add("recognizer");
    events.push(`${name}:settled`);
    callback(null, value);
  }

  mock.module("koffi", () => ({
    default: {
      load: () => ({
        func: (signature: string) => {
          const name = signature.match(/\b(vosk_\w+)\(/)?.[1];
          if (!name) throw new Error(`Unexpected FFI signature: ${signature}`);
          return Object.assign(
            () => {
              check(name);
              if (
                name === "vosk_model_free" ||
                name === "vosk_recognizer_free"
              ) {
                const handle =
                  name === "vosk_model_free" ? "model" : "recognizer";
                if (!live.delete(handle))
                  violations.push(`${handle} freed twice`);
                events.push(`${handle}:free`);
              }
              return name.endsWith("_result") ? '{"text":"home"}' : 0;
            },
            {
              async: (...args: unknown[]) => {
                check(name);
                events.push(`${name}:started`);
                callbacks.set(name, args.at(-1) as NativeCallback);
              },
            },
          );
        },
        unload: () => {
          events.push("library:unload");
          if (!loaded) violations.push("library unloaded twice");
          loaded = false;
        },
      }),
    },
  }));

  try {
    const { loadVosk } = await import("../src/vosk");
    const loading = loadVosk(libraryPath, modelPath);
    await checkpoint();
    complete(MODEL_NEW, "model");
    const model = await loading;
    const creating = model.createDecoder().then(
      (decoder) => decoder,
      () => null,
    );
    if (scenario === "creation") {
      const closing = model.close();
      await checkpoint();
      const releasedWhilePending = !loaded || !live.has("model");
      complete(RECOGNIZER_NEW, "recognizer");
      const decoder = await creating;
      let usableAfterClose = false;
      if (decoder) {
        const inference = decoder.accept(new Float32Array([0])).then(
          () => true,
          () => false,
        );
        await checkpoint();
        if (callbacks.has(ACCEPT)) complete(ACCEPT, 1);
        usableAfterClose = await inference;
        await decoder.close();
      }
      await closing;
      await model.close();
      return { events, violations, releasedWhilePending, usableAfterClose };
    }

    complete(RECOGNIZER_NEW, "recognizer");
    const decoder = await creating;
    if (!decoder) throw new Error("Recognizer creation unexpectedly failed");
    const first = decoder.accept(new Float32Array([0]));
    const second = decoder.accept(new Float32Array([0]));
    await checkpoint();
    const decoderClosing = decoder.close();
    const closing = model.close();
    await checkpoint();
    const releasedWhilePending = !loaded || live.size !== 2;
    complete(ACCEPT, 1);
    await checkpoint();
    complete(ACCEPT, 1);
    await Promise.all([first, second, decoderClosing, closing]);
    const usableAfterClose = await decoder.accept(new Float32Array([0])).then(
      () => true,
      () => false,
    );
    await decoder.close();
    await model.close();
    return { events, violations, releasedWhilePending, usableAfterClose };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[2] === PROBE_ARGUMENT) {
  const scenario = process.argv[3];
  if (scenario !== "creation" && scenario !== "accept")
    throw new Error(`Unknown Vosk lifetime scenario: ${scenario}`);
  console.log(JSON.stringify(await probe(scenario)));
} else {
  for (const scenario of ["creation", "accept"] as const) {
    test(`Vosk close preserves native resources during pending ${scenario}`, async () => {
      const child = Bun.spawn(
        [process.execPath, import.meta.path, PROBE_ARGUMENT, scenario],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
      const inferenceEvents =
        scenario === "accept"
          ? [
              `${ACCEPT}:started`,
              `${ACCEPT}:settled`,
              `${ACCEPT}:started`,
              `${ACCEPT}:settled`,
            ]
          : [];
      expect(JSON.parse(stdout)).toEqual({
        events: [
          `${MODEL_NEW}:started`,
          `${MODEL_NEW}:settled`,
          `${RECOGNIZER_NEW}:started`,
          `${RECOGNIZER_NEW}:settled`,
          ...inferenceEvents,
          "recognizer:free",
          "model:free",
          "library:unload",
        ],
        violations: [],
        releasedWhilePending: false,
        usableAfterClose: false,
      });
    });
  }
}
