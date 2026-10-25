import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import {
  FRENCH_MODEL_DIRECTORY,
  LOCAL_MODEL_DIRECTORY,
  VOSK_VERSION,
  voiceAssets,
} from "../src/vosk";
import { buildWindowsVoice } from "./build-voice-windows";

const REVISIONS = {
  vosk: {
    repository: "alphacep/vosk-api",
    sha: "a7bf6a51e299152a8fb496b928a21eb79a1d7bea",
  },
  kaldi: {
    repository: "alphacep/kaldi",
    sha: "bc5baf14231660bd50b7d05788865b4ac6c34481",
  },
  openfst: {
    repository: "alphacep/openfst",
    sha: "18e94e63870ebcf79ebb42b7035cd3cb626ec090",
  },
};
const MODEL_SHA256 =
  "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498";
const FRENCH_MODEL_SHA256 =
  "cabf6180e177eb9b3a9a9d43a437bd5e549f3a7d09525e5d69a3fed787be12ad";
export const VOICE_MINIMUM_MACOS = "14.0";
const MINIMUM_MACOS = VOICE_MINIMUM_MACOS;
const BUILD_JOBS = process.platform === "linux" ? "1" : "2";
const MAX_ERROR_LENGTH = 4000;
const APACHE_LICENSE_URL = "https://www.apache.org/licenses/LICENSE-2.0.txt";
const LINUX_LAPACK_PATCH = "kaldi-lapack-string-lengths-v1";
const LINUX_COMPILE_PATCH = "kaldi-pic-no-debug-v1";
const LINUX_SOURCE_PATCHES = [
  LINUX_LAPACK_PATCH,
  LINUX_COMPILE_PATCH,
  "linux-openblas-pthread-v1",
];

async function download(url: string, path: string, expectedHash?: string) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Voice asset download failed (${response.status}): ${url}`);
  const data = new Uint8Array(await response.arrayBuffer());
  if (
    expectedHash &&
    createHash("sha256").update(data).digest("hex") !== expectedHash
  )
    throw new Error(`Voice asset checksum mismatch: ${url}`);
  await Bun.write(path, data);
}

async function run(
  root: string,
  name: string,
  command: string,
  args: string[],
  cwd = root,
  environment = {},
) {
  const log = join(root, `${name}.log`);
  const file = openSync(log, "w");
  console.log(`Voice build: ${name} (${log})`);
  try {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...(process.platform === "darwin"
          ? { MACOSX_DEPLOYMENT_TARGET: MINIMUM_MACOS }
          : {}),
        ...environment,
      },
      stdio: ["ignore", file, file],
    });
    const code = await new Promise<number | null>((resolve, reject) => {
      child.once("close", resolve);
      child.once("error", reject);
    });
    if (code !== 0)
      throw new Error(
        `${name} failed (${code}): ${readFileSync(log, "utf8").slice(-MAX_ERROR_LENGTH)}`,
      );
  } finally {
    closeSync(file);
  }
}

export async function buildVoice(root: string, outdir: string) {
  const cache = join(
    root,
    "node_modules/.cache/astra-voice",
    `${VOSK_VERSION}-${process.platform}-${process.arch}`,
  );
  const assets = voiceAssets(join(cache, "assets"));
  mkdirSync(cache, { recursive: true });
  const validCache =
    existsSync(assets.manifest) &&
    existsSync(assets.library) &&
    existsSync(join(assets.model, "am/final.mdl"));
  if (validCache) {
    const manifest = JSON.parse(readFileSync(assets.manifest, "utf8"));
    const digest = createHash("sha256")
      .update(readFileSync(assets.library))
      .digest("hex");
    if (
      manifest.version !== VOSK_VERSION ||
      manifest.architecture !== process.arch ||
      manifest.librarySha256 !== digest ||
      (process.platform === "linux" &&
        !LINUX_SOURCE_PATCHES.every((patch) =>
          manifest.sourcePatches?.includes(patch),
        ))
    )
      throw new Error(
        `Invalid cached voice runtime. Remove only ${cache} and rebuild.`,
      );
  } else if (process.platform === "win32" && process.arch === "x64") {
    await buildWindowsVoice(root, cache);
    return buildVoice(root, outdir);
  } else {
    if (process.platform !== "darwin" && process.platform !== "linux")
      throw new Error(
        "Native voice builds support macOS, Linux, and Windows x64. Use x64 Bun to build Windows, including on Windows ARM.",
      );
    const sources = join(cache, "sources");
    mkdirSync(sources, { recursive: true });
    for (const [name, source] of Object.entries(REVISIONS)) {
      const directory = join(sources, name);
      if (existsSync(directory)) continue;
      const archive = join(sources, `${name}.tar.gz`);
      await download(
        `https://api.github.com/repos/${source.repository}/tarball/${source.sha}`,
        archive,
      );
      mkdirSync(directory);
      await run(cache, `${name}-extract`, "/usr/bin/tar", [
        "-xzf",
        archive,
        "--strip-components=1",
        "-C",
        directory,
      ]);
    }
    const openfst = join(sources, "openfst");
    const kaldi = join(sources, "kaldi");
    const vosk = join(sources, "vosk");
    if (process.platform === "linux") {
      await buildLinuxRuntime(cache, sources, assets);
    } else {
      const install = join(cache, "openfst-install");
      const brewPrefix =
        process.arch === "arm64" ? "/opt/homebrew" : "/usr/local";
      if (!existsSync(join(openfst, "configure")))
        await run(
          cache,
          "openfst-autoreconf",
          join(brewPrefix, "bin/autoreconf"),
          ["-fi"],
          openfst,
          { LIBTOOLIZE: join(brewPrefix, "bin/glibtoolize") },
        );
      if (!existsSync(join(install, "lib/libfstngram.a"))) {
        await run(
          cache,
          "openfst-configure",
          "./configure",
          [
            `--prefix=${install}`,
            "--enable-static",
            "--disable-shared",
            "--enable-far",
            "--enable-ngram-fsts",
            "--enable-lookahead-fsts",
            "--with-pic",
            "--disable-bin",
            "CXX=clang++",
            `CXXFLAGS=-O2 -g0 -std=c++17 -mmacosx-version-min=${MINIMUM_MACOS}`,
          ],
          openfst,
        );
        await run(
          cache,
          "openfst-build",
          "/usr/bin/make",
          ["-j", BUILD_JOBS, "install"],
          openfst,
        );
      }
      await run(
        cache,
        "kaldi-configure",
        "./configure",
        [
          "--static",
          "--static-fst",
          "--use-cuda=no",
          `--fst-root=${install}`,
          "--fst-version=1.8.0",
        ],
        join(kaldi, "src"),
      );
      if (process.arch === "arm64") {
        const configuration = join(kaldi, "src/kaldi.mk");
        writeFileSync(
          configuration,
          readFileSync(configuration, "utf8").replace(/-msse2?\b/g, ""),
        );
      }
      await run(
        cache,
        "kaldi-build",
        "/usr/bin/make",
        [
          "-j",
          BUILD_JOBS,
          "online2",
          "lm",
          "rnnlm",
          `EXTRA_CXXFLAGS=-g0 -O2 -mmacosx-version-min=${MINIMUM_MACOS}`,
        ],
        join(kaldi, "src"),
      );
      mkdirSync(assets.directory, { recursive: true });
      await run(
        cache,
        "vosk-build",
        "/usr/bin/make",
        [
          "-j",
          BUILD_JOBS,
          `KALDI_ROOT=${kaldi}`,
          `OPENFST_ROOT=${install}`,
          "HAVE_OPENBLAS_CLAPACK=0",
          "HAVE_ACCELERATE=1",
          "EXT=dylib",
          "CXX=clang++",
          `OUTDIR=${assets.directory}`,
          `EXTRA_CFLAGS=-g0 -O2 -mmacosx-version-min=${MINIMUM_MACOS}`,
          "EXTRA_LDFLAGS=-Wl,-install_name,@rpath/libvosk.dylib",
        ],
        join(vosk, "src"),
      );
      await run(cache, "vosk-strip", "/usr/bin/strip", [
        "-S",
        "-x",
        assets.library,
      ]);
    }
    const archive = join(cache, `${LOCAL_MODEL_DIRECTORY}.zip`);
    await download(
      `https://alphacephei.com/vosk/models/${LOCAL_MODEL_DIRECTORY}.zip`,
      archive,
      MODEL_SHA256,
    );
    await run(cache, "model-extract", "/usr/bin/unzip", [
      "-q",
      "-o",
      archive,
      "-d",
      assets.directory,
    ]);
    const licenses = join(assets.directory, "licenses");
    mkdirSync(licenses, { recursive: true });
    for (const [name, directory] of Object.entries({
      Vosk: vosk,
      Kaldi: kaldi,
      OpenFst: openfst,
    }))
      cpSync(join(directory, "COPYING"), join(licenses, `${name}.txt`));
    if (process.platform === "linux")
      for (const [name, path] of Object.entries({
        OpenBLAS: "/usr/share/doc/libopenblas0-pthread/copyright",
        LAPACKE: "/usr/share/doc/liblapacke/copyright",
      }))
        cpSync(path, join(licenses, `${name}.txt`));
    writeFileSync(
      join(licenses, "SimpleJSON.txt"),
      `${readFileSync(join(vosk, "src/json.h"), "utf8").split("\n").slice(0, 7).join("\n")}\n`,
    );
    cpSync(
      join(root, "node_modules/koffi/LICENSE.txt"),
      join(licenses, "Koffi.txt"),
    );
    await download(APACHE_LICENSE_URL, join(licenses, "Model-Apache-2.0.txt"));
    const manifest = {
      version: VOSK_VERSION,
      revisions: REVISIONS,
      architecture: process.arch,
      platform: process.platform,
      ...(process.platform === "linux"
        ? {
            sourcePatches: LINUX_SOURCE_PATCHES,
            mathBackend: "openblas-pthread",
          }
        : {}),
      ...(process.platform === "darwin"
        ? { minimumMacos: MINIMUM_MACOS }
        : {
            minimumGlibc: execFileSync("getconf", ["GNU_LIBC_VERSION"], {
              encoding: "utf8",
            })
              .trim()
              .split(" ")
              .at(-1),
          }),
      librarySha256: createHash("sha256")
        .update(readFileSync(assets.library))
        .digest("hex"),
      model: LOCAL_MODEL_DIRECTORY,
      modelArchiveSha256: MODEL_SHA256,
    };
    writeFileSync(assets.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  const manifest = JSON.parse(readFileSync(assets.manifest, "utf8"));
  if (
    !existsSync(join(assets.frenchModel, "am/final.mdl")) ||
    manifest.frenchModelArchiveSha256 !== FRENCH_MODEL_SHA256
  ) {
    const archive = join(cache, `${FRENCH_MODEL_DIRECTORY}.zip`);
    await download(
      `https://alphacephei.com/vosk/models/${FRENCH_MODEL_DIRECTORY}.zip`,
      archive,
      FRENCH_MODEL_SHA256,
    );
    if (process.platform === "win32") {
      const command = `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${assets.directory.replaceAll("'", "''")}' -Force`;
      await run(cache, "french-model-extract", "powershell.exe", [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(command, "utf16le").toString("base64"),
      ]);
    } else {
      await run(cache, "french-model-extract", "/usr/bin/unzip", [
        "-q",
        "-o",
        archive,
        "-d",
        assets.directory,
      ]);
    }
    manifest.frenchModel = FRENCH_MODEL_DIRECTORY;
    manifest.frenchModelArchiveSha256 = FRENCH_MODEL_SHA256;
    writeFileSync(assets.manifest, `${JSON.stringify(manifest, null, 2)}\n`);
  }
  cpSync(assets.directory, join(outdir, "voice"), { recursive: true });
}

async function buildLinuxRuntime(
  cache: string,
  sources: string,
  assets: ReturnType<typeof voiceAssets>,
) {
  let blasLibrary: string;
  let blasInclude: string;
  let lapackLibrary: string;
  try {
    blasLibrary = execFileSync(
      "pkg-config",
      ["--variable=libdir", "openblas"],
      {
        encoding: "utf8",
      },
    ).trim();
    blasInclude = execFileSync(
      "pkg-config",
      ["--variable=includedir", "openblas"],
      { encoding: "utf8" },
    ).trim();
    lapackLibrary = execFileSync(
      "pkg-config",
      ["--variable=libdir", "lapacke"],
      { encoding: "utf8" },
    ).trim();
    if (!existsSync(join(blasLibrary, "libopenblas.a")))
      throw new Error("OpenBLAS static library is missing.");
    if (basename(blasLibrary) !== "openblas-pthread")
      throw new Error("Linux voice requires the pthread OpenBLAS variant.");
    if (!existsSync(join(lapackLibrary, "liblapacke.a")))
      throw new Error("LAPACKE static library is missing.");
  } catch {
    throw new Error(
      "Building Linux voice requires autoconf, automake, g++, make, libtool, gfortran, pkg-config, libopenblas-pthread-dev, and liblapacke-dev. Install these build packages, select the pthread OpenBLAS pkg-config entry, and retry.",
    );
  }
  const openfst = join(sources, "openfst");
  const kaldi = join(sources, "kaldi");
  const vosk = join(sources, "vosk");
  const wrapper = join(kaldi, "src/matrix/cblas-wrappers.h");
  const original = readFileSync(wrapper, "utf8");
  const routines = [
    "stptri",
    "dtptri",
    "sgesvd",
    "dgesvd",
    "ssptri",
    "dsptri",
    "ssptrf",
    "dsptrf",
  ];
  // LAPACK's wrappers supply the Fortran ABI's trailing character lengths.
  const patched = original.replace(
    new RegExp(`\\b(${routines.join("|")})_\\(`, "g"),
    "LAPACK_$1(",
  );
  if (!routines.every((routine) => patched.includes(`LAPACK_${routine}(`)))
    throw new Error(
      "The Linux Kaldi LAPACK wrapper patch did not apply completely.",
    );
  if (patched !== original) writeFileSync(wrapper, patched);
  const install = join(cache, "openfst-install");
  const blas = join(cache, "openblas");
  const mathLibraries = `-Wl,--start-group ${join(lapackLibrary, "liblapacke.a")} ${join(blasLibrary, "libopenblas.a")} -Wl,--end-group -lgfortran`;
  mkdirSync(join(blas, "lib"), { recursive: true });
  for (const name of ["libopenblas.a", "libopenblas.so"]) {
    rmSync(join(blas, "lib", name), { force: true });
    symlinkSync(join(blasLibrary, name), join(blas, "lib", name));
  }
  rmSync(join(blas, "include"), { force: true });
  symlinkSync(blasInclude, join(blas, "include"), "dir");
  if (!existsSync(join(openfst, "configure")))
    await run(cache, "openfst-autoreconf", "autoreconf", ["-fi"], openfst);
  if (!existsSync(join(install, "lib/libfstngram.a"))) {
    await run(
      cache,
      "openfst-configure",
      "./configure",
      [
        `--prefix=${install}`,
        "--enable-static",
        "--disable-shared",
        "--enable-far",
        "--enable-ngram-fsts",
        "--enable-lookahead-fsts",
        "--with-pic",
        "--disable-bin",
        "CXXFLAGS=-O2 -g0 -std=c++17",
      ],
      openfst,
    );
    await run(
      cache,
      "openfst-build",
      "make",
      ["-j", BUILD_JOBS, "install"],
      openfst,
    );
  }
  await run(
    cache,
    "kaldi-configure",
    "./configure",
    [
      "--static",
      "--static-fst",
      "--static-math",
      "--use-cuda=no",
      "--mathlib=OPENBLAS",
      `--openblas-root=${blas}`,
      `--fst-root=${install}`,
      "--fst-version=1.8.0",
    ],
    join(kaldi, "src"),
  );
  const configuration = join(kaldi, "src/kaldi.mk");
  writeFileSync(
    configuration,
    readFileSync(configuration, "utf8").replace(/(\s)-g(?=\s|$)/g, "$1-g0"),
  );
  const compileMarker = join(cache, LINUX_COMPILE_PATCH);
  if (!existsSync(compileMarker)) {
    for (const artifact of new Bun.Glob("**/*.{o,a}").scanSync(
      join(kaldi, "src"),
    ))
      rmSync(join(kaldi, "src", artifact));
    writeFileSync(compileMarker, `${LINUX_COMPILE_PATCH}\n`);
  }
  await run(
    cache,
    "kaldi-build",
    "make",
    [
      "-j",
      BUILD_JOBS,
      "online2",
      "lm",
      "rnnlm",
      "EXTRA_CXXFLAGS=-g0 -O2 -fPIC",
      `OPENBLASLIBS=${mathLibraries}`,
    ],
    join(kaldi, "src"),
  );
  mkdirSync(assets.directory, { recursive: true });
  await run(
    cache,
    "vosk-build",
    "make",
    [
      "-j",
      BUILD_JOBS,
      `KALDI_ROOT=${kaldi}`,
      `OPENFST_ROOT=${install}`,
      "HAVE_OPENBLAS_CLAPACK=0",
      "EXT=so",
      `OUTDIR=${assets.directory}`,
      `EXTRA_CFLAGS=-g0 -O2 -DHAVE_OPENBLAS=1 -I${blasInclude}`,
      `EXTRA_LDFLAGS=${mathLibraries} -pthread -Wl,--no-undefined`,
    ],
    join(vosk, "src"),
  );
  await run(cache, "vosk-strip", "strip", ["--strip-unneeded", assets.library]);
}
