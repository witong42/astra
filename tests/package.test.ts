import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
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
  "packaging preserves older releases and signs the selected version with its native permissions",
  () => {
    const root = mkdtempSync(join(tmpdir(), "codexos package-test-"));
    temporary.push(root);
    const electron = join(root, "node_modules/electron/dist/Electron.app");
    mkdirSync(join(electron, "Contents/MacOS"), { recursive: true });
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "dist"));
    for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"])
      writeFileSync(join(root, file), `Astra fixture ${file}`);
    for (const file of ["LICENSE", "LICENSES.chromium.html"])
      writeFileSync(
        join(root, "node_modules/electron/dist", file),
        `Electron fixture ${file}`,
      );
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
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ version: "9.8.7", astraBuild: 42 }),
    );
    const previous = join(root, "release/v9.8.6/Astra.app");
    mkdirSync(previous, { recursive: true });
    writeFileSync(join(previous, "preserve"), "previous release");
    const packageScript = join(root, "scripts/package.ts");
    cpSync(join(import.meta.dir, "../scripts/package.ts"), packageScript);
    execFileSync(process.execPath, [packageScript], { cwd: root });
    const app = join(root, "release/v9.8.7/Astra.app");
    for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"])
      expect(
        readFileSync(join(app, "Contents/Resources/app", file), "utf8"),
      ).toBe(`Astra fixture ${file}`);
    for (const file of ["LICENSE", "LICENSES.chromium.html"])
      expect(readFileSync(join(app, "Contents/Resources", file), "utf8")).toBe(
        `Electron fixture ${file}`,
      );
    const plist = join(app, "Contents/Info.plist");
    const metadata = JSON.parse(
      execFileSync("/usr/bin/plutil", ["-convert", "json", "-o", "-", plist], {
        encoding: "utf8",
      }),
    );
    expect(metadata.CFBundleShortVersionString).toBe("9.8.7");
    expect(metadata.CFBundleVersion).toBe("42");
    expect(readFileSync(join(previous, "preserve"), "utf8")).toBe(
      "previous release",
    );
    expect(
      JSON.parse(
        readFileSync(join(app, "Contents/Resources/app/package.json"), "utf8"),
      ),
    ).toMatchObject({ version: "9.8.7", astraBuild: 42 });
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

test("packaging rejects missing or invalid release identity before creating output", () => {
  for (const identity of [
    { version: "1.2.3" },
    { version: "../../other", astraBuild: 2 },
    { version: "1.2.3", astraBuild: 0 },
  ]) {
    const root = mkdtempSync(join(tmpdir(), "astra-invalid-release-"));
    temporary.push(root);
    mkdirSync(join(root, "scripts"));
    writeFileSync(join(root, "package.json"), JSON.stringify(identity));
    const script = join(root, "scripts/package.ts");
    cpSync(join(import.meta.dir, "../scripts/package.ts"), script);
    const result = Bun.spawnSync([process.execPath, script], { cwd: root });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("valid version and astraBuild");
    expect(existsSync(join(root, "release"))).toBe(false);
  }
});
