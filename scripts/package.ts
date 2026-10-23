import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const output = join(root, "release/Astra.app");
if (existsSync(output))
  throw new Error(
    "release/Astra.app already exists. Move the previous package before packaging a new one.",
  );
mkdirSync(join(root, "release"), { recursive: true });
execFileSync("/usr/bin/ditto", [
  join(root, "node_modules/electron/dist/Electron.app"),
  output,
]);
const resources = join(output, "Contents/Resources");
cpSync(join(root, "dist/icon.icns"), join(resources, "icon.icns"));
cpSync(join(root, "dist"), join(resources, "app/dist"), { recursive: true });
const source = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
writeFileSync(
  join(resources, "app/package.json"),
  JSON.stringify({
    name: "astra",
    productName: "Astra",
    version: source.version,
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
  CFBundleName: "Astra",
  CFBundleDisplayName: "Astra",
  CFBundleIdentifier: "local.codexos.desktop",
  CFBundleShortVersionString: source.version,
  CFBundleVersion: "1",
  CFBundleIconFile: "icon.icns",
  NSMicrophoneUsageDescription:
    "Listen locally for Astra while voice is enabled, including in the background. Pause the microphone at any time.",
  NSSpeechRecognitionUsageDescription:
    "Transcribe French and English voice requests on this Mac for your existing Codex agent.",
})) {
  const command = Object.hasOwn(existing, key)
    ? `Set :${key} ${value}`
    : `Add :${key} string ${value}`;
  execFileSync("/usr/libexec/PlistBuddy", ["-c", command, plist]);
}
execFileSync(
  "/usr/bin/codesign",
  ["--force", "--deep", "--sign", "-", output],
  { stdio: "inherit" },
);
execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", output]);
console.log(output);
