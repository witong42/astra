import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0))
    rmSync(directory, { recursive: true });
});

test.skipIf(process.platform !== "darwin")(
  "packaged app declares why it needs Apple Events before signing",
  () => {
    const root = mkdtempSync(join(tmpdir(), "codexos package-test-"));
    temporary.push(root);
    const electron = join(root, "node_modules/electron/dist/Electron.app");
    mkdirSync(join(electron, "Contents/MacOS"), { recursive: true });
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "dist"));
    cpSync("/usr/bin/true", join(electron, "Contents/MacOS/Electron"));
    writeFileSync(
      join(electron, "Contents/Info.plist"),
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>Electron</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleName</key><string>Electron</string>
<key>CFBundleDisplayName</key><string>Electron</string>
<key>CFBundleIdentifier</key><string>com.example.fixture</string>
<key>CFBundleShortVersionString</key><string>0.0.0</string>
<key>CFBundleVersion</key><string>1</string>
<key>CFBundleIconFile</key><string>electron.icns</string>
<key>NSMicrophoneUsageDescription</key><string>Electron default microphone description</string>
</dict></plist>`,
    );
    writeFileSync(join(root, "dist/icon.icns"), "fixture");
    writeFileSync(join(root, "dist/main.cjs"), "// fixture");
    writeFileSync(join(root, "package.json"), '{"version":"0.1.0"}');
    const packageScript = join(root, "scripts/package.ts");
    cpSync(join(import.meta.dir, "../scripts/package.ts"), packageScript);
    execFileSync(process.execPath, [packageScript], { cwd: root });
    const app = join(root, "release/Astra.app");
    const plist = join(app, "Contents/Info.plist");
    const usage = execFileSync(
      "/usr/libexec/PlistBuddy",
      ["-c", "Print :NSAppleEventsUsageDescription", plist],
      { encoding: "utf8" },
    ).trim();
    expect(usage).toContain("Mac applications");
    expect(usage).toContain("request");
    for (const key of [
      "CFBundleName",
      "CFBundleDisplayName",
      "NSMicrophoneUsageDescription",
    ]) {
      const value = execFileSync(
        "/usr/libexec/PlistBuddy",
        ["-c", `Print :${key}`, plist],
        { encoding: "utf8" },
      );
      expect(value).toContain("Astra");
    }
    expect(
      execFileSync(
        "/usr/libexec/PlistBuddy",
        ["-c", "Print :NSSpeechRecognitionUsageDescription", plist],
        { encoding: "utf8" },
      ),
    ).toContain("French and English");
    expect(
      readFileSync(join(app, "Contents/Resources/app/dist/main.cjs"), "utf8"),
    ).toBe("// fixture");
    execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  },
);
