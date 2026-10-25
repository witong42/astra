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
  writeFileSync(join(source, "voice-helper"), "obsolete native capture");
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
  expect(existsSync(join(destination, "voice-helper"))).toBe(false);
});

test.skipIf(process.platform !== "darwin" || process.arch !== "arm64")(
  "packaging preserves older releases and signs the selected version with its native permissions",
  () => {
    const root = mkdtempSync(join(tmpdir(), "astra package-test-"));
    temporary.push(root);
    const electron = join(root, "node_modules/electron/dist/Electron.app");
    execFileSync("/usr/bin/ditto", [
      join(import.meta.dir, "../node_modules/electron/dist/Electron.app"),
      electron,
    ]);
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
    const electronPlist = join(electron, "Contents/Info.plist");
    const originalMetadata = JSON.parse(
      execFileSync(
        "/usr/bin/plutil",
        ["-convert", "json", "-o", "-", electronPlist],
        { encoding: "utf8" },
      ),
    );
    const speechPermission = Object.hasOwn(
      originalMetadata,
      "NSSpeechRecognitionUsageDescription",
    )
      ? "Set :NSSpeechRecognitionUsageDescription Legacy Apple speech permission"
      : "Add :NSSpeechRecognitionUsageDescription string Legacy Apple speech permission";
    execFileSync("/usr/libexec/PlistBuddy", [
      "-c",
      speechPermission,
      electronPlist,
    ]);
    writeFileSync(join(root, "dist/icon.icns"), "fixture");
    const fixtureMain = `const {app,BrowserWindow}=require('electron');
app.setPath('userData',${JSON.stringify(join(root, "profile"))});
app.whenReady().then(async()=>{
  app.dock?.hide();
  const window=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await window.loadURL('data:text/html,<title>Astra package probe</title>');
  const renderer=await window.webContents.executeJavaScript('document.readyState');
  console.log('ASTRA_PACKAGE_PROBE '+JSON.stringify({packaged:app.isPackaged,renderer,version:app.getVersion()}));
  window.destroy();app.quit();
}).catch(error=>{console.error(error);app.exit(1)});`;
    writeFileSync(join(root, "dist/main.cjs"), fixtureMain);
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
    const runtimeEnvironment = { ...process.env };
    delete runtimeEnvironment.ELECTRON_RUN_AS_NODE;
    delete runtimeEnvironment.ELECTRON_FORCE_IS_PACKAGED;
    const probeApp = join(root, "runtime-probe/Astra.app");
    execFileSync("/usr/bin/ditto", [app, probeApp]);
    execFileSync("/usr/libexec/PlistBuddy", [
      "-c",
      "Set :CFBundleIdentifier io.github.witong42.astra.package-test",
      join(probeApp, "Contents/Info.plist"),
    ]);
    execFileSync("/usr/bin/codesign", [
      "--force",
      "--deep",
      "--sign",
      "-",
      probeApp,
    ]);
    const runtime = execFileSync(
      join(probeApp, "Contents/MacOS", metadata.CFBundleExecutable),
      [],
      { encoding: "utf8", env: runtimeEnvironment, timeout: 10_000 },
    );
    const result = runtime
      .split("\n")
      .find((line) => line.startsWith("ASTRA_PACKAGE_PROBE "));
    if (!result)
      throw new Error(`Packaged runtime returned no probe result: ${runtime}`);
    expect(JSON.parse(result.slice("ASTRA_PACKAGE_PROBE ".length))).toEqual({
      packaged: true,
      renderer: "complete",
      version: "9.8.7",
    });
    expect(metadata.CFBundleExecutable).toBe("Astra");
    expect(existsSync(join(app, "Contents/MacOS/Electron"))).toBe(false);
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
    ).toBe(fixtureMain);
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
