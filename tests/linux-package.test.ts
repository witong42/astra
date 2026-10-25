import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { packageLinux } from "../scripts/package-linux";

test.skipIf(
  process.platform !== "linux" || !["arm64", "x64"].includes(process.arch),
)(
  "Linux package includes only runtime assets, native sandbox permissions and a bundled CLI",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "astra Linux package "));
    const write = (name: string, value: string) => {
      const path = join(root, name);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, value);
    };
    try {
      for (const name of [
        "main.cjs",
        "astra.cjs",
        "preload.cjs",
        "audio-preload.cjs",
        "renderer.js",
        "audio-host.js",
        "audio-worklet.js",
        "canvas.html",
        "index.html",
        "styles.css",
        "audio-host.html",
        "install.sh",
        "install.ps1",
        "icon.png",
        "dock.png",
        "brand.css",
        "outfit.ttf",
        "astra-logo.svg",
        "OFL-Outfit.txt",
      ])
        write(`dist/${name}`, "fixture");
      for (const name of [
        "LICENSE",
        "THIRD_PARTY_NOTICES.md",
        "node_modules/electron/dist/LICENSE",
        "node_modules/electron/dist/LICENSES.chromium.html",
      ])
        write(name, "license fixture");
      write("node_modules/electron/dist/electron", "");
      copyFileSync(
        "/usr/bin/true",
        join(root, "node_modules/electron/dist/electron"),
      );
      chmodSync(join(root, "node_modules/electron/dist/electron"), 0o755);
      write("node_modules/electron/dist/chrome-sandbox", "sandbox fixture");
      write("node_modules/koffi/package.json", '{"name":"koffi"}');
      const addon = `node_modules/@koromix/koffi-linux-${process.arch}/linux_${process.arch}/koffi.node`;
      write(addon, "");
      copyFileSync("/usr/bin/true", join(root, addon));
      write("dist/voice/libvosk.so", "");
      copyFileSync("/usr/bin/true", join(root, "dist/voice/libvosk.so"));
      write(
        "dist/voice/runtime.json",
        JSON.stringify({ platform: "linux", architecture: process.arch }),
      );
      write(
        "dist/voice/vosk-model-small-en-us-0.15/am/final.mdl",
        "model fixture",
      );
      write(
        "dist/voice/vosk-model-small-fr-0.22/am/final.mdl",
        "French model fixture",
      );
      write("dist/voice/licenses/Vosk.txt", "voice license");
      write("dist/voice/recognizer.o", "must not ship");
      write("dist/client/server-secret.txt", "must not ship");
      const release = join(root, "release/v9.8.7");
      write(
        "dist/voice/runtime.json",
        JSON.stringify({
          platform: "linux",
          architecture: process.arch === "x64" ? "arm64" : "x64",
        }),
      );
      await expect(
        packageLinux(root, release, { version: "9.8.7", astraBuild: 42 }),
      ).rejects.toThrow("wrong platform or architecture");
      write(
        "dist/voice/runtime.json",
        JSON.stringify({ platform: "linux", architecture: process.arch }),
      );
      const previousPath = process.env.PATH;
      const previousMarker = process.env.ASTRA_TEST_PACKAGE_MARKER;
      write(
        "tools/dpkg-deb",
        '#!/bin/sh\nfor target do :; done\nprintf interrupted > "$target"\nprintf reached > "$ASTRA_TEST_PACKAGE_MARKER"\nexit 7\n',
      );
      chmodSync(join(root, "tools/dpkg-deb"), 0o755);
      process.env.PATH = `${join(root, "tools")}:${previousPath ?? ""}`;
      process.env.ASTRA_TEST_PACKAGE_MARKER = join(root, "interrupted");
      try {
        await expect(
          packageLinux(root, release, { version: "9.8.7", astraBuild: 42 }),
        ).rejects.toThrow();
        expect(existsSync(join(root, "interrupted"))).toBe(true);
        expect(readdirSync(release)).toEqual([]);
      } finally {
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
        if (previousMarker === undefined)
          delete process.env.ASTRA_TEST_PACKAGE_MARKER;
        else process.env.ASTRA_TEST_PACKAGE_MARKER = previousMarker;
      }
      const archive = await packageLinux(root, release, {
        version: "9.8.7",
        astraBuild: 42,
      });
      const info = execFileSync("dpkg-deb", ["--field", archive], {
        encoding: "utf8",
      });
      expect(info).toContain(
        `Architecture: ${process.arch === "x64" ? "amd64" : "arm64"}`,
      );
      expect(archive).toEndWith(`Astra-9.8.7-linux-${process.arch}.deb`);
      expect(info).toContain("Version: 9.8.7-42");
      expect(info).toContain("Depends:");
      expect(info).toContain("libc6");
      expect(info).toContain("pkexec");
      const extracted = join(root, "extracted");
      execFileSync("dpkg-deb", ["--extract", archive, extracted]);
      expect(
        statSync(join(extracted, "usr/lib/astra/chrome-sandbox")).mode & 0o7777,
      ).toBe(0o4755);
      expect(
        statSync(join(extracted, "usr/lib/astra/astra")).mode & 0o777,
      ).toBe(0o755);
      const listing = execFileSync("dpkg-deb", ["--contents", archive], {
        encoding: "utf8",
      });
      expect(listing).toContain("root/root");
      const app = join(extracted, "usr/lib/astra/resources/app");
      expect(
        JSON.parse(readFileSync(join(app, "package.json"), "utf8")),
      ).toMatchObject({
        version: "9.8.7",
        astraBuild: 42,
        desktopName: "io.github.witong42.astra.desktop",
      });
      expect(
        readFileSync(join(app, "dist/voice/licenses/Vosk.txt"), "utf8"),
      ).toBe("voice license");
      expect(
        readFileSync(
          join(app, "dist/voice/vosk-model-small-fr-0.22/am/final.mdl"),
          "utf8",
        ),
      ).toBe("French model fixture");
      expect(existsSync(join(app, "dist/voice/recognizer.o"))).toBe(false);
      expect(existsSync(join(app, "dist/client"))).toBe(false);
      const cli = readFileSync(join(extracted, "usr/bin/astra"), "utf8");
      expect(cli).toContain("ELECTRON_RUN_AS_NODE=1");
      expect(cli).toContain('"$@"');
      expect(cli).not.toContain("bun");
      const desktop = readFileSync(
        join(
          extracted,
          "usr/share/applications/io.github.witong42.astra.desktop",
        ),
        "utf8",
      );
      expect(desktop).toContain("Exec=/usr/lib/astra/astra");
      expect(desktop).toContain(
        "Icon=/usr/lib/astra/resources/app/dist/icon.png",
      );
      expect(desktop).not.toContain("--no-sandbox");
      expect(readFileSync(`${archive}.sha256`, "utf8")).toStartWith(
        createHash("sha256").update(readFileSync(archive)).digest("hex"),
      );
      await expect(
        packageLinux(root, release, { version: "9.8.7", astraBuild: 42 }),
      ).rejects.toThrow("already exists");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
  30_000,
);
