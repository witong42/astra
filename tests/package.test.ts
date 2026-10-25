import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyDesktopBuild } from "../scripts/package-files";
import { packageMacArchives } from "../scripts/package-macos";

const temporary: string[] = [];
const DISK_IMAGE_TEST_TIMEOUT = 60_000;
afterEach(() => {
  for (const directory of temporary.splice(0))
    rmSync(directory, { recursive: true });
});

test("desktop packages omit stale phone and marketing builds while retaining their voice runtime", () => {
  const root = mkdtempSync(join(tmpdir(), "astra-desktop-files-"));
  temporary.push(root);
  const source = join(root, "dist");
  const destination = join(root, "package/dist");
  mkdirSync(join(source, "voice"), { recursive: true });
  writeFileSync(join(source, "main.cjs"), "desktop main");
  writeFileSync(join(source, "voice/runtime.json"), "desktop voice");
  for (const directory of ["client", "server", "website"]) {
    mkdirSync(join(source, directory));
    writeFileSync(join(source, directory, "private.txt"), "private web build");
  }
  copyDesktopBuild(source, destination);
  expect(readFileSync(join(destination, "main.cjs"), "utf8")).toBe(
    "desktop main",
  );
  expect(readFileSync(join(destination, "voice/runtime.json"), "utf8")).toBe(
    "desktop voice",
  );
  for (const directory of ["client", "server", "website"])
    expect(existsSync(join(destination, directory))).toBe(false);
});

test.skipIf(process.platform !== "darwin" || process.arch !== "arm64")(
  "packaging preserves older releases and signs the selected version with its native permissions",
  () => {
    const root = mkdtempSync(join(tmpdir(), "astra package-test-"));
    temporary.push(root);
    const electron = join(root, "node_modules/electron/dist/Electron.app");
    mkdirSync(join(electron, "Contents/MacOS"), { recursive: true });
    mkdirSync(join(root, "scripts"));
    mkdirSync(join(root, "dist"));
    for (const name of [
      "koffi",
      `@koromix/koffi-${process.platform}-${process.arch}`,
    ]) {
      mkdirSync(join(root, "node_modules", name), { recursive: true });
      writeFileSync(
        join(root, "node_modules", name, "package.json"),
        JSON.stringify({ name, version: "3.3.4" }),
      );
    }
    mkdirSync(join(root, "dist/voice/licenses"), { recursive: true });
    writeFileSync(
      join(root, "dist/voice/runtime.json"),
      '{"version":"0.3.50"}',
    );
    writeFileSync(
      join(root, "dist/voice/licenses/Vosk.txt"),
      "Apache-2.0 fixture",
    );
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
<key>NSSpeechRecognitionUsageDescription</key><string>Legacy Apple speech permission</string>
</dict></plist>`,
    );
    writeFileSync(join(root, "dist/icon.icns"), "fixture");
    writeFileSync(join(root, "dist/main.cjs"), "// fixture");
    for (const name of ["client", "server", "website"]) {
      mkdirSync(join(root, "dist", name));
      writeFileSync(
        join(root, "dist", name, "private.txt"),
        "private web build",
      );
    }
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ version: "9.8.7", astraBuild: 42 }),
    );
    const previous = join(root, "release/v9.8.6/Astra.app");
    mkdirSync(previous, { recursive: true });
    writeFileSync(join(previous, "preserve"), "previous release");
    const packageScript = join(root, "scripts/package.ts");
    cpSync(join(import.meta.dir, "../scripts/package.ts"), packageScript);
    cpSync(
      join(import.meta.dir, "../scripts/package-files.ts"),
      join(root, "scripts/package-files.ts"),
    );
    const archivesScript = join(import.meta.dir, "../scripts/package-macos.ts");
    cpSync(archivesScript, join(root, "scripts/package-macos.ts"));
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
    expect(metadata.CFBundleIdentifier).toBe("io.github.witong42.astra");
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
    expect(metadata.NSSpeechRecognitionUsageDescription).toBeUndefined();
    expect(metadata.LSMinimumSystemVersion).toBe("14.0");
    expect(
      readFileSync(
        join(app, "Contents/Resources/app/dist/voice/licenses/Vosk.txt"),
        "utf8",
      ),
    ).toBe("Apache-2.0 fixture");
    for (const name of [
      "koffi",
      `@koromix/koffi-${process.platform}-${process.arch}`,
    ])
      expect(
        JSON.parse(
          readFileSync(
            join(
              app,
              "Contents/Resources/app/node_modules",
              name,
              "package.json",
            ),
            "utf8",
          ),
        ).version,
      ).toBe("3.3.4");
    expect(
      readFileSync(join(app, "Contents/Resources/app/dist/main.cjs"), "utf8"),
    ).toBe("// fixture");
    execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
    const release = join(root, "release/v9.8.7");
    for (const name of ["client", "server", "website"])
      expect(existsSync(join(app, "Contents/Resources/app/dist", name))).toBe(
        false,
      );
    const image = join(release, "Astra-9.8.7-macos-arm64.dmg");
    const zip = join(release, "Astra-macos-arm64.zip");
    for (const archive of [image, zip]) {
      expect(existsSync(archive)).toBe(true);
      const digest = createHash("sha256")
        .update(readFileSync(archive))
        .digest("hex");
      expect(readFileSync(`${archive}.sha256`, "utf8")).toStartWith(digest);
    }
    const imageDigest = readFileSync(`${image}.sha256`, "utf8");
    expect(() => packageMacArchives(app, release, "9.8.7")).toThrow(
      "already exists",
    );
    expect(readFileSync(`${image}.sha256`, "utf8")).toBe(imageDigest);
    const wrongRelease = join(root, "wrong-version");
    expect(() => packageMacArchives(app, wrongRelease, "9.8.8")).toThrow(
      "the app contains 9.8.7",
    );
    expect(existsSync(wrongRelease)).toBe(false);
    const unpacked = join(root, "unpacked");
    execFileSync("/usr/bin/ditto", ["-xk", zip, unpacked]);
    execFileSync("/usr/bin/codesign", [
      "--verify",
      "--deep",
      "--strict",
      join(unpacked, "Astra.app"),
    ]);
    const mount = join(root, "mounted");
    mkdirSync(mount);
    execFileSync("/usr/bin/hdiutil", [
      "attach",
      image,
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      mount,
    ]);
    try {
      expect(readlinkSync(join(mount, "Applications"))).toBe("/Applications");
      expect(
        readFileSync(join(mount, "Astra.app/Contents/Info.plist")),
      ).toEqual(readFileSync(plist));
      execFileSync("/usr/bin/codesign", [
        "--verify",
        "--deep",
        "--strict",
        join(mount, "Astra.app"),
      ]);
    } finally {
      execFileSync("/usr/bin/hdiutil", ["detach", mount]);
    }
  },
  DISK_IMAGE_TEST_TIMEOUT,
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
    cpSync(
      join(import.meta.dir, "../scripts/package-files.ts"),
      join(root, "scripts/package-files.ts"),
    );
    const result = Bun.spawnSync([process.execPath, script], { cwd: root });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("valid version and astraBuild");
    expect(existsSync(join(root, "release"))).toBe(false);
  }
});
