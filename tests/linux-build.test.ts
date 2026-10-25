import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { VOSK_VERSION } from "../src/vosk";

const NATIVE_CORPUS_TIMEOUT_MS = 120_000;
const NATIVE_CORPUS_BLAS_THREADS = "1";

test.skipIf(process.platform !== "linux")(
  "Linux voice ships notices for its linked pthread math libraries",
  () => {
    const voice = join(import.meta.dir, "../dist/voice");
    const manifest = JSON.parse(
      readFileSync(join(voice, "runtime.json"), "utf8"),
    );
    expect(manifest.mathBackend).toBe("openblas-pthread");
    for (const [name, original] of Object.entries({
      OpenBLAS: "/usr/share/doc/libopenblas0-pthread/copyright",
      LAPACKE: "/usr/share/doc/liblapacke/copyright",
    }))
      expect(readFileSync(join(voice, "licenses", `${name}.txt`), "utf8")).toBe(
        readFileSync(original, "utf8"),
      );
  },
);

test.skipIf(process.platform !== "linux")(
  "Linux recorded voice corpus runs concurrently in Electron's native runtime",
  async () => {
    const root = join(import.meta.dir, "..");
    mkdirSync(join(root, "test-results"), { recursive: true });
    const directory = mkdtempSync(join(root, "test-results/linux-corpus-"));
    try {
      const built = await Bun.build({
        entrypoints: [join(import.meta.dir, "native-runtime.ts")],
        outdir: directory,
        target: "node",
        format: "cjs",
        naming: "native-runtime.cjs",
        external: ["koffi"],
      });
      if (!built.success)
        throw new AggregateError(built.logs, "Native corpus build failed");
      const stdout = execFileSync(
        join(root, "node_modules/electron/dist/electron"),
        [
          built.outputs[0].path,
          join(root, "dist/voice"),
          join(import.meta.dir, "fixtures/voice"),
        ],
        {
          encoding: "utf8",
          timeout: NATIVE_CORPUS_TIMEOUT_MS,
          env: {
            ...process.env,
            ELECTRON_RUN_AS_NODE: "1",
            OPENBLAS_NUM_THREADS: NATIVE_CORPUS_BLAS_THREADS,
          },
        },
      );
      const report = JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
      expect(report.passed).toBeGreaterThanOrEqual(96);
      expect(report.platform).toBe("linux");
      expect(report.architecture).toBe(process.arch);
      const source = JSON.parse(
        readFileSync(join(root, "package.json"), "utf8"),
      );
      expect(report.electron).toBe(source.devDependencies.electron);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  NATIVE_CORPUS_TIMEOUT_MS + 10_000,
);

test.skipIf(process.platform !== "linux")(
  "Kaldi static objects can link into the Linux shared voice runtime",
  () => {
    const directory = mkdtempSync(join(tmpdir(), "astra-kaldi-pic-"));
    try {
      const archive = join(
        import.meta.dir,
        "../node_modules/.cache/astra-voice",
        `${VOSK_VERSION}-linux-${process.arch}`,
        "sources/kaldi/src/base/kaldi-base.a",
      );
      execFileSync(
        "g++",
        [
          "-shared",
          "-Wl,--whole-archive",
          archive,
          "-Wl,--no-whole-archive",
          "-o",
          join(directory, "base.so"),
        ],
        { timeout: 10_000, stdio: "pipe" },
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  15_000,
);

test.skipIf(process.platform !== "linux")(
  "Linux voice math headers and static libraries compile and run together",
  () => {
    const directory = mkdtempSync(join(tmpdir(), "astra-linux-math-"));
    try {
      const library = (name: string) =>
        execFileSync("pkg-config", ["--variable=libdir", name], {
          encoding: "utf8",
        }).trim();
      const source = join(directory, "math.cc");
      const executable = join(directory, "math");
      writeFileSync(
        source,
        "#include <lapacke.h>\n#include <cblas.h>\n#include <stdio.h>\nint main() { if (!(LAPACKE_slamch('E') > 0)) return 1; puts(\"MATH_READY\"); return 0; }\n",
      );
      execFileSync(
        "g++",
        [
          "-std=c++17",
          source,
          join(library("lapacke"), "liblapacke.a"),
          join(library("openblas"), "libopenblas.a"),
          "-lgfortran",
          "-pthread",
          "-o",
          executable,
        ],
        { timeout: 10_000, stdio: "pipe" },
      );
      expect(execFileSync(executable, { encoding: "utf8" }).trim()).toBe(
        "MATH_READY",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  15_000,
);

test.skipIf(process.platform !== "linux")(
  "Kaldi LAPACK wrappers pass float and double packed-inverse numerical checks",
  () => {
    const directory = mkdtempSync(join(tmpdir(), "astra-kaldi-math-"));
    try {
      const cache = join(
        import.meta.dir,
        "../node_modules/.cache/astra-voice",
        `${VOSK_VERSION}-linux-${process.arch}`,
      );
      const kaldi = join(cache, "sources/kaldi/src");
      const library = (name: string) =>
        execFileSync("pkg-config", ["--variable=libdir", name], {
          encoding: "utf8",
        }).trim();
      const executable = join(directory, "inverse");
      execFileSync(
        "g++",
        [
          "-std=c++17",
          "-DHAVE_OPENBLAS",
          "-DKALDI_DOUBLEPRECISION=0",
          "-DHAVE_EXECINFO_H=1",
          "-DHAVE_CXXABI_H",
          `-I${kaldi}`,
          `-I${join(cache, "openblas/include")}`,
          "-isystem",
          join(cache, "openfst-install/include"),
          join(import.meta.dir, "fixtures/linux-lapack.cc"),
          join(kaldi, "base/kaldi-base.a"),
          join(library("lapacke"), "liblapacke.a"),
          join(library("openblas"), "libopenblas.a"),
          "-lgfortran",
          "-pthread",
          "-ldl",
          "-o",
          executable,
        ],
        { timeout: 10_000, stdio: "pipe" },
      );
      expect(execFileSync(executable, { encoding: "utf8" })).toBe(
        "float PACKED_TRIANGULAR_INVERSE_READY\ndouble PACKED_TRIANGULAR_INVERSE_READY\n",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  15_000,
);
