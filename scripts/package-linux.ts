import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { FRENCH_MODEL_DIRECTORY, LOCAL_MODEL_DIRECTORY } from "../src/vosk";
import { BRAND_FILES } from "./icon";

const DESKTOP_NAME = "io.github.witong42.astra.desktop";
const DESKTOP_FILES = [
  "main.cjs",
  "astra.cjs",
  "preload.cjs",
  "audio-preload.cjs",
  "renderer.js",
  "audio-host.js",
  "audio-worklet.js",
  "index.html",
  "styles.css",
  "canvas.html",
  "audio-host.html",
  "install.sh",
  "install.ps1",
  "icon.png",
  "dock.png",
  ...BRAND_FILES,
];

export async function packageLinux(
  root: string,
  release: string,
  source: { version: string; astraBuild: number },
) {
  const architecture = process.arch;
  if (
    process.platform !== "linux" ||
    (architecture !== "arm64" && architecture !== "x64")
  )
    throw new Error("Build the Linux package on Linux ARM64 or x64.");
  const debianArchitecture = architecture === "x64" ? "amd64" : "arm64";
  const archive = join(
    release,
    `Astra-${source.version}-linux-${architecture}.deb`,
  );
  if (existsSync(archive))
    throw new Error(`${archive} already exists. Increase the release version.`);
  const addon = `@koromix/koffi-linux-${architecture}`;
  const addonBinary = `linux_${architecture}/koffi.node`;
  for (const file of [
    ...DESKTOP_FILES.map((name) => `dist/${name}`),
    "dist/voice/libvosk.so",
    "dist/voice/runtime.json",
    `dist/voice/${LOCAL_MODEL_DIRECTORY}/am/final.mdl`,
    `dist/voice/${FRENCH_MODEL_DIRECTORY}/am/final.mdl`,
    `node_modules/${addon}/${addonBinary}`,
    "node_modules/electron/dist/chrome-sandbox",
  ])
    if (!existsSync(join(root, file)))
      throw new Error(
        `Linux package is missing ${file}. Run the Linux build first.`,
      );
  const manifest = JSON.parse(
    readFileSync(join(root, "dist/voice/runtime.json"), "utf8"),
  );
  if (manifest.platform !== "linux" || manifest.architecture !== architecture)
    throw new Error(
      "Linux voice runtime has the wrong platform or architecture.",
    );
  mkdirSync(release, { recursive: true });
  const temporary = mkdtempSync(join(release, ".linux-package-"));
  try {
    const staging = join(temporary, "package");
    mkdirSync(join(staging, "DEBIAN"), { recursive: true });
    const install = join(staging, "usr/lib/astra");
    cpSync(join(root, "node_modules/electron/dist"), install, {
      recursive: true,
    });
    renameSync(join(install, "electron"), join(install, "astra"));
    chmodSync(join(install, "chrome-sandbox"), 0o4755);
    const app = join(install, "resources/app");
    mkdirSync(join(app, "dist/voice"), { recursive: true });
    for (const file of DESKTOP_FILES)
      cpSync(join(root, "dist", file), join(app, "dist", file));
    for (const name of [
      "libvosk.so",
      "runtime.json",
      "licenses",
      LOCAL_MODEL_DIRECTORY,
      FRENCH_MODEL_DIRECTORY,
    ])
      cpSync(join(root, "dist/voice", name), join(app, "dist/voice", name), {
        recursive: true,
      });
    for (const name of ["koffi", addon])
      cpSync(
        join(root, "node_modules", name),
        join(app, "node_modules", name),
        { recursive: true, dereference: true },
      );
    for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"])
      cpSync(join(root, name), join(app, name));
    writeFileSync(
      join(app, "package.json"),
      JSON.stringify({
        name: "astra",
        productName: "Astra",
        version: source.version,
        astraBuild: source.astraBuild,
        desktopName: DESKTOP_NAME,
        main: "dist/main.cjs",
      }),
    );
    mkdirSync(join(staging, "usr/bin"), { recursive: true });
    writeFileSync(
      join(staging, "usr/bin/astra"),
      '#!/bin/sh\nexec env ELECTRON_RUN_AS_NODE=1 /usr/lib/astra/astra /usr/lib/astra/resources/app/dist/astra.cjs "$@"\n',
      { mode: 0o755 },
    );
    mkdirSync(join(staging, "usr/share/applications"), { recursive: true });
    writeFileSync(
      join(staging, "usr/share/applications", DESKTOP_NAME),
      `[Desktop Entry]
Type=Application
Name=Astra
Comment=Personal desktop assistant
Exec=/usr/lib/astra/astra
Icon=/usr/lib/astra/resources/app/dist/icon.png
Terminal=false
Categories=Utility;
StartupWMClass=Astra
`,
    );
    mkdirSync(join(temporary, "debian"));
    writeFileSync(
      join(temporary, "debian/control"),
      `Source: astra\n\nPackage: astra\nArchitecture: ${debianArchitecture}\n`,
    );
    const dependencyOutput = execFileSync(
      "dpkg-shlibdeps",
      [
        "-O",
        `-l${install}`,
        `-e${join(install, "astra")}`,
        `-e${join(app, "dist/voice/libvosk.so")}`,
        `-e${join(app, "node_modules", addon, addonBinary)}`,
      ],
      { cwd: temporary, encoding: "utf8" },
    );
    const nativeDependencies = dependencyOutput
      .split("\n")
      .find((line) => line.startsWith("shlibs:Depends="))
      ?.slice("shlibs:Depends=".length);
    if (!nativeDependencies)
      throw new Error("Could not determine Linux runtime dependencies.");
    writeFileSync(
      join(staging, "DEBIAN/control"),
      `Package: astra
Version: ${source.version}-${source.astraBuild}
Architecture: ${debianArchitecture}
Section: utils
Priority: optional
Maintainer: Astra contributors
Homepage: https://github.com/witong42/astra
Depends: ${nativeDependencies}, libgtk-3-0t64, xdg-utils, pkexec
Installed-Size: ${Math.ceil(directoryBytes(join(staging, "usr")) / 1024)}
Description: Personal desktop assistant with offline wake recognition
 Astra turns conversations into mini-apps and provides native Linux shell actions.
`,
    );
    normalizePermissions(staging);
    chmodSync(join(install, "chrome-sandbox"), 0o4755);
    const completed = join(temporary, "Astra.deb");
    execFileSync(
      "dpkg-deb",
      ["--build", "--root-owner-group", "-Zzstd", "-z6", staging, completed],
      { stdio: "inherit" },
    );
    const digest = createHash("sha256")
      .update(readFileSync(completed))
      .digest("hex");
    renameSync(completed, archive);
    writeFileSync(
      `${archive}.sha256`,
      `${digest}  ${archive.split("/").at(-1)}\n`,
    );
    console.log(archive);
    return archive;
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function directoryBytes(directory: string): number {
  return readdirSync(directory, { withFileTypes: true }).reduce(
    (total, entry) => {
      const path = join(directory, entry.name);
      return (
        total +
        (entry.isDirectory() ? directoryBytes(path) : statSync(path).size)
      );
    },
    0,
  );
}

function normalizePermissions(directory: string) {
  chmodSync(directory, 0o755);
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) normalizePermissions(path);
    else if (!entry.isSymbolicLink())
      chmodSync(path, statSync(path).mode & 0o111 ? 0o755 : 0o644);
  }
}
