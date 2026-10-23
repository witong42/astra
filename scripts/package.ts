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
const output = join(root, "release/CodexOS.app");
if (existsSync(output))
  throw new Error(
    "release/CodexOS.app already exists. Move the previous package before packaging a new one.",
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
    name: "codexos",
    productName: "CodexOS",
    version: source.version,
    main: "dist/main.cjs",
  }),
);
const plist = join(output, "Contents/Info.plist");
for (const [key, value] of Object.entries({
  CFBundleName: "CodexOS",
  CFBundleDisplayName: "CodexOS",
  CFBundleIdentifier: "local.codexos.desktop",
  CFBundleShortVersionString: source.version,
  CFBundleVersion: "1",
  CFBundleIconFile: "icon.icns",
}))
  execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    `Set :${key} ${value}`,
    plist,
  ]);
execFileSync(
  "/usr/bin/codesign",
  ["--force", "--deep", "--sign", "-", output],
  { stdio: "inherit" },
);
execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", output]);
console.log(output);
