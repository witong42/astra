import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { copyDesktopBuild } from "./package-files";

const root = join(import.meta.dir, "..");
const MINIMUM_MACOS = "14.0";
const MAC_EXECUTABLE = "Astra";
const source = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const RELEASE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
if (
  typeof source.version !== "string" ||
  !RELEASE_VERSION.test(source.version) ||
  !Number.isSafeInteger(source.astraBuild) ||
  source.astraBuild < 1
)
  throw new Error(
    "package.json requires a valid version and astraBuild greater than zero.",
  );
const release = join(root, "release", `v${source.version}`);
if (process.platform === "win32") {
  const { packageWindows } = await import("./package-windows");
  await packageWindows(root, release, source);
} else if (process.platform === "linux") {
  const { packageLinux } = await import("./package-linux");
  await packageLinux(root, release, source);
} else {
  const output = join(release, "Astra.app");
  if (existsSync(output))
    throw new Error(
      `${output} already exists. Increase the release version before packaging again.`,
    );
  mkdirSync(release, { recursive: true });
  execFileSync("/usr/bin/ditto", [
    join(root, "node_modules/electron/dist/Electron.app"),
    output,
  ]);
  renameSync(
    join(output, "Contents/MacOS/Electron"),
    join(output, "Contents/MacOS", MAC_EXECUTABLE),
  );
  const resources = join(output, "Contents/Resources");
  cpSync(join(root, "dist/icon.icns"), join(resources, "icon.icns"));
  copyDesktopBuild(join(root, "dist"), join(resources, "app/dist"));
  for (const name of [
    "koffi",
    `@koromix/koffi-${process.platform}-${process.arch}`,
  ])
    cpSync(
      join(root, "node_modules", name),
      join(resources, "app/node_modules", name),
      { recursive: true, dereference: true },
    );
  for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"])
    cpSync(join(root, file), join(resources, "app", file));
  for (const file of ["LICENSE", "LICENSES.chromium.html"])
    cpSync(
      join(root, "node_modules/electron/dist", file),
      join(resources, file),
    );
  writeFileSync(
    join(resources, "app/package.json"),
    JSON.stringify({
      name: "astra",
      productName: "Astra",
      version: source.version,
      astraBuild: source.astraBuild,
      main: "dist/main.cjs",
    }),
  );
  const plist = join(output, "Contents/Info.plist");
  const existing = JSON.parse(
    execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", plist], {
      encoding: "utf8",
    }),
  );
  for (const [key, value] of Object.entries({
    CFBundleExecutable: MAC_EXECUTABLE,
    CFBundleName: "Astra",
    CFBundleDisplayName: "Astra",
    CFBundleIdentifier: "io.github.witong42.astra",
    CFBundleShortVersionString: source.version,
    CFBundleVersion: String(source.astraBuild),
    CFBundleIconFile: "icon.icns",
    LSMinimumSystemVersion: MINIMUM_MACOS,
    NSAppleEventsUsageDescription:
      "Astra mini-apps use AppleScript to automate Mac applications when you request an action.",
    NSMicrophoneUsageDescription:
      "Listen locally for Astra while voice is enabled, including in the background. Pause the microphone at any time.",
  })) {
    const command = Object.hasOwn(existing, key)
      ? `Set :${key} ${value}`
      : `Add :${key} string ${value}`;
    execFileSync("/usr/libexec/PlistBuddy", ["-c", command, plist]);
  }
  if (Object.hasOwn(existing, "NSSpeechRecognitionUsageDescription"))
    execFileSync("/usr/libexec/PlistBuddy", [
      "-c",
      "Delete :NSSpeechRecognitionUsageDescription",
      plist,
    ]);
  execFileSync(
    "/usr/bin/codesign",
    ["--force", "--deep", "--sign", "-", output],
    { stdio: "inherit" },
  );
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", output]);
  const packagedAt = new Date();
  utimesSync(output, packagedAt, packagedAt);
  console.log(output);
  const { packageMacArchives } = await import("./package-macos");
  console.log(packageMacArchives(output, release, source.version));
}
