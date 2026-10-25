import { existsSync } from "node:fs";
import { join } from "node:path";
import type { LibraryHandle } from "koffi";
import { z } from "zod";
import { PHONE_SAMPLE_RATE } from "./phone-audio";

export const LOCAL_KEYWORDS = ["astra", "home", "[unk]"];
const FRENCH_KEYWORDS = [...LOCAL_KEYWORDS, "astre"];
export const VOSK_VERSION = "0.3.50";
export const LOCAL_MODEL_DIRECTORY = "vosk-model-small-en-us-0.15";
export const FRENCH_MODEL_DIRECTORY = "vosk-model-small-fr-0.22";

export function voiceAssets(directory: string, platform = process.platform) {
  const extension =
    platform === "darwin" ? "dylib" : platform === "win32" ? "dll" : "so";
  return {
    directory,
    library: join(directory, `libvosk.${extension}`),
    model: join(directory, LOCAL_MODEL_DIRECTORY),
    frenchModel: join(directory, FRENCH_MODEL_DIRECTORY),
    manifest: join(directory, "runtime.json"),
  };
}
const PCM_MAX = 32767;
const PCM_SAMPLE_BYTES = Int16Array.BYTES_PER_ELEMENT;
const NATIVE_LOG_LEVEL = -1;
const wordSchema = z.object({
  word: z.string(),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
});
const resultSchema = z.object({
  text: z.string().optional(),
  partial: z.string().optional(),
  result: z.array(wordSchema).optional(),
  partial_result: z.array(wordSchema).optional(),
});
type ForeignFunction = ReturnType<LibraryHandle["func"]>;

export type SpeechWord = { word: string; start: number; end: number };

export type DecodedSpeech = {
  text: string;
  final: boolean;
  words: SpeechWord[];
};

export type SpeechDecoder = {
  accept: (samples: Float32Array) => Promise<DecodedSpeech>;
  finish: () => Promise<DecodedSpeech>;
  close: () => Promise<void>;
};

export type VoskModel = {
  createDecoder: () => Promise<SpeechDecoder>;
  close: () => Promise<void>;
};

function nativeCall<T>(call: ForeignFunction, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) =>
    call.async(...args, (error: Error | null, result: T) =>
      error ? reject(error) : resolve(result),
    ),
  );
}

function encodePcm(samples: Float32Array) {
  const data = Buffer.alloc(samples.length * PCM_SAMPLE_BYTES);
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index];
    if (!Number.isFinite(sample))
      throw new Error("PCM samples must be finite.");
    data.writeInt16LE(
      Math.round(Math.max(-1, Math.min(1, sample)) * PCM_MAX),
      index * PCM_SAMPLE_BYTES,
    );
  }
  return data;
}

export async function loadVosk(
  libraryPath: string,
  modelPath: string,
  keywords = LOCAL_KEYWORDS,
  partialWords = false,
): Promise<VoskModel> {
  if (!existsSync(libraryPath))
    throw new Error(
      `The local voice library is missing: ${libraryPath}. Rebuild Astra.`,
    );
  if (!existsSync(join(modelPath, "am/final.mdl")))
    throw new Error(
      `The local voice model is missing: ${modelPath}. Rebuild Astra.`,
    );
  const { default: koffi } = await import("koffi");
  const library = koffi.load(libraryPath);
  const modelNew = library.func("void *vosk_model_new(const char *path)");
  const modelFree = library.func("void vosk_model_free(void *model)");
  const findWord = library.func(
    "int vosk_model_find_word(void *model, const char *word)",
  );
  const recognizerNew = library.func(
    "void *vosk_recognizer_new_grm(void *model, float rate, const char *grammar)",
  );
  const recognizerFree = library.func(
    "void vosk_recognizer_free(void *recognizer)",
  );
  const setWords = library.func(
    "void vosk_recognizer_set_words(void *recognizer, int enabled)",
  );
  const setPartialWords = library.func(
    "void vosk_recognizer_set_partial_words(void *recognizer, int enabled)",
  );
  const accept = library.func(
    "int vosk_recognizer_accept_waveform(void *recognizer, const uint8_t *data, int length)",
  );
  const finalResult = library.func(
    "const char *vosk_recognizer_result(void *recognizer)",
  );
  const partialResult = library.func(
    "const char *vosk_recognizer_partial_result(void *recognizer)",
  );
  library.func("void vosk_set_log_level(int level)")(NATIVE_LOG_LEVEL);
  const model = await nativeCall<unknown>(modelNew, modelPath);
  if (!model) {
    library.unload();
    throw new Error(`Vosk could not load the local voice model: ${modelPath}`);
  }
  for (const word of keywords)
    if (findWord(model, word) < 0) {
      modelFree(model);
      library.unload();
      throw new Error(
        `The local voice model does not contain ${word}. Install the supported Astra model.`,
      );
    }
  const decoders = new Set<SpeechDecoder>();
  const creating = new Set<Promise<SpeechDecoder>>();
  let closing: Promise<void> | null = null;
  const createDecoder = () => {
    if (closing)
      return Promise.reject(
        new Error("The local voice model has been released."),
      );
    const operation = (async () => {
      const handle = await nativeCall<unknown>(
        recognizerNew,
        model,
        PHONE_SAMPLE_RATE,
        JSON.stringify(keywords),
      );
      if (!handle)
        throw new Error("Vosk could not start local voice recognition.");
      if (closing) {
        recognizerFree(handle);
        throw new Error("The local voice model has been released.");
      }
      setWords(handle, 1);
      setPartialWords(handle, partialWords ? 1 : 0);
      let pending = Promise.resolve();
      let closed: Promise<void> | null = null;
      const enqueue = (work: () => Promise<DecodedSpeech>) => {
        if (closed)
          return Promise.reject(
            new Error("Local voice recognition has stopped."),
          );
        const operation = pending.then(work);
        pending = operation.then(
          () => {},
          () => {},
        );
        return operation;
      };
      const decode = (json: string, final: boolean): DecodedSpeech => {
        const result = resultSchema.parse(JSON.parse(json));
        return {
          text: result.text ?? result.partial ?? "",
          words: result.result ?? result.partial_result ?? [],
          final,
        };
      };
      const decoder: SpeechDecoder = {
        accept: (samples) => {
          const data = encodePcm(samples);
          return enqueue(async () => {
            const ready = await nativeCall<number>(
              accept,
              handle,
              data,
              data.length,
            );
            if (ready < 0)
              throw new Error("Vosk could not process this microphone frame.");
            return decode(
              ready ? finalResult(handle) : partialResult(handle),
              ready !== 0,
            );
          });
        },
        finish: () => enqueue(async () => decode(finalResult(handle), true)),
        close: () => {
          closed ??= pending.then(() => {
            recognizerFree(handle);
            decoders.delete(decoder);
          });
          return closed;
        },
      };
      decoders.add(decoder);
      return decoder;
    })();
    creating.add(operation);
    operation.then(
      () => creating.delete(operation),
      () => creating.delete(operation),
    );
    return operation;
  };
  return {
    createDecoder,
    close: () => {
      closing ??= (async () => {
        await Promise.allSettled([...creating]);
        await Promise.all([...decoders].map((decoder) => decoder.close()));
        modelFree(model);
        library.unload();
      })();
      return closing;
    },
  };
}

export async function loadLocalModel(
  assets: ReturnType<typeof voiceAssets>,
): Promise<VoskModel> {
  const english = await loadVosk(assets.library, assets.model);
  let french: VoskModel;
  try {
    french = await loadVosk(
      assets.library,
      assets.frenchModel,
      FRENCH_KEYWORDS,
      true,
    );
  } catch (error) {
    await english.close();
    throw error;
  }
  let closing: Promise<void> | null = null;
  const select = ([primary, alternative]: DecodedSpeech[]) =>
    alternative.text.split(/\s+/).includes("astra") ? alternative : primary;
  return {
    createDecoder: async () => {
      if (closing) throw new Error("The local voice model has been released.");
      const primary = await english.createDecoder();
      let alternative: SpeechDecoder;
      try {
        alternative = await french.createDecoder();
      } catch (error) {
        await primary.close();
        throw error;
      }
      const close = async () => {
        await Promise.all([primary.close(), alternative.close()]);
      };
      if (closing) {
        await close();
        throw new Error("The local voice model has been released.");
      }
      return {
        accept: async (samples) =>
          select(
            await Promise.all([
              primary.accept(samples),
              alternative.accept(samples),
            ]),
          ),
        finish: async () =>
          select(await Promise.all([primary.finish(), alternative.finish()])),
        close,
      };
    },
    close: () => {
      closing ??= Promise.all([english.close(), french.close()]).then(() => {});
      return closing;
    },
  };
}
