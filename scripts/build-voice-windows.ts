import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { LOCAL_MODEL_DIRECTORY, VOSK_VERSION } from "../src/vosk";

const MODEL_SHA256 =
  "30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498";
const SOURCES = {
  vosk: {
    repository: "alphacep/vosk-api",
    sha: "a7bf6a51e299152a8fb496b928a21eb79a1d7bea",
  },
  "windows-kaldi": {
    repository: "alphacep/kaldi",
    sha: "8b7fecf92b329b7253d9d1cd97898c8b13f9aef3",
  },
  openfst: {
    repository: "alphacep/openfst",
    sha: "18e94e63870ebcf79ebb42b7035cd3cb626ec090",
  },
  openblas: {
    repository: "OpenMathLib/OpenBLAS",
    sha: "e0166008be8e466242aa76b2ff75ce3f0fbf574a",
  },
  clapack: {
    repository: "alphacep/clapack",
    sha: "f4e1647de96343fb20eea08a9d4f0e0d04c31c51",
  },
};

async function download(url: string, destination: string, digest?: string) {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(
      `Windows voice download failed (${response.status}): ${url}`,
    );
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (digest && createHash("sha256").update(bytes).digest("hex") !== digest)
    throw new Error(`Windows voice checksum mismatch: ${url}`);
  writeFileSync(destination, bytes);
}

export async function buildWindowsVoice(root: string, cache: string) {
  try {
    execFileSync("docker", ["info", "--format", "{{.OSType}}"], {
      stdio: "pipe",
    });
  } catch {
    throw new Error(
      "Building Windows Vosk from source requires Docker with Linux containers. Start Docker Desktop and rebuild. Packaged Astra includes the offline runtime.",
    );
  }
  const context = join(cache, "sources");
  const assets = join(cache, "assets");
  mkdirSync(context, { recursive: true });
  for (const [name, source] of Object.entries(SOURCES)) {
    const archive = join(context, `${name}.tar.gz`);
    if (!existsSync(archive))
      await download(
        `https://api.github.com/repos/${source.repository}/tarball/${source.sha}`,
        archive,
      );
  }
  writeFileSync(
    join(context, "revisions.json"),
    JSON.stringify(SOURCES, null, 2),
  );
  writeFileSync(
    join(context, "windows-kaldi-revision.json"),
    JSON.stringify(SOURCES["windows-kaldi"], null, 2),
  );
  const image = `astra-vosk-windows:${VOSK_VERSION}`;
  execFileSync(
    "docker",
    [
      "build",
      "--file",
      join(root, "native/VoskWindows.Dockerfile"),
      "--tag",
      image,
      "--build-arg",
      "VOICE_CORE_JOBS=2",
      context,
    ],
    { stdio: "inherit" },
  );
  const container = execFileSync("docker", ["create", image], {
    encoding: "utf8",
  }).trim();
  mkdirSync(assets, { recursive: true });
  try {
    execFileSync(
      "docker",
      ["cp", `${container}:/opt/astra-windows/.`, assets],
      { stdio: "inherit" },
    );
  } finally {
    execFileSync("docker", ["rm", container], { stdio: "pipe" });
  }
  const archive = join(cache, `${LOCAL_MODEL_DIRECTORY}.zip`);
  await download(
    `https://alphacephei.com/vosk/models/${LOCAL_MODEL_DIRECTORY}.zip`,
    archive,
    MODEL_SHA256,
  );
  if (process.platform === "win32") {
    const command = `Expand-Archive -LiteralPath '${archive.replaceAll("'", "''")}' -DestinationPath '${assets.replaceAll("'", "''")}' -Force`;
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(command, "utf16le").toString("base64"),
      ],
      { stdio: "inherit" },
    );
  } else
    execFileSync("unzip", ["-q", "-o", archive, "-d", assets], {
      stdio: "inherit",
    });
  const licenses = join(assets, "licenses");
  cpSync(
    join(root, "node_modules/koffi/LICENSE.txt"),
    join(licenses, "Koffi.txt"),
  );
  await download(
    "https://www.apache.org/licenses/LICENSE-2.0.txt",
    join(licenses, "Model-Apache-2.0.txt"),
  );
  writeFileSync(
    join(assets, "runtime.json"),
    JSON.stringify(
      {
        version: VOSK_VERSION,
        platform: "win32",
        architecture: "x64",
        sources: SOURCES,
        librarySha256: createHash("sha256")
          .update(readFileSync(join(assets, "libvosk.dll")))
          .digest("hex"),
        model: LOCAL_MODEL_DIRECTORY,
        modelArchiveSha256: MODEL_SHA256,
      },
      null,
      2,
    ),
  );
}
