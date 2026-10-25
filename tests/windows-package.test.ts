import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { windowsInstaller } from "../scripts/package-windows";

test.skipIf(process.platform !== "win32")(
  "Windows installation verifies the complete bundle, preserves data, and rejects a damaged update",
  () => {
    const directory = mkdtempSync(join(tmpdir(), "astra-install-test-"));
    try {
      const source = join(directory, "package");
      const local = join(directory, "local");
      const roaming = join(directory, "roaming");
      const profile = join(roaming, "Astra/workspace.json");
      mkdirSync(source, { recursive: true });
      mkdirSync(join(roaming, "Astra"), { recursive: true });
      writeFileSync(profile, "saved apps and conversations");
      writeFileSync(join(source, "Astra.exe"), "verified executable fixture");
      writeFileSync(
        join(source, "app-manifest.json"),
        JSON.stringify({
          version: "9.8.7",
          files: [
            {
              path: "Astra.exe",
              sha256: createHash("sha256")
                .update("verified executable fixture")
                .digest("hex"),
            },
          ],
        }),
      );
      const installer = join(source, "Install.ps1");
      writeFileSync(installer, `\uFEFF${windowsInstaller("9.8.7")}`);
      const run = (destination?: string) =>
        execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            installer,
            "-NoLaunch",
            ...(destination ? ["-Destination", destination] : []),
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              LOCALAPPDATA: local,
              APPDATA: roaming,
              USERPROFILE: join(directory, "user"),
            },
          },
        );
      expect(run()).toContain("Installed Astra 9.8.7");
      const installed = join(local, "Programs/Astra/9.8.7/Astra.exe");
      expect(readFileSync(installed, "utf8")).toBe(
        "verified executable fixture",
      );
      expect(
        existsSync(
          join(roaming, "Microsoft/Windows/Start Menu/Programs/Astra.lnk"),
        ),
      ).toBe(true);
      expect(
        readFileSync(join(directory, "user/.local/bin/astra.cmd"), "utf8"),
      ).toContain("ELECTRON_RUN_AS_NODE=1");
      const installedDirectory = join(local, "Programs/Astra/9.8.7");
      writeFileSync(
        join(installedDirectory, "obsolete.txt"),
        "stale version file",
      );
      writeFileSync(join(source, "Astra.exe"), "updated executable fixture");
      writeFileSync(
        join(source, "app-manifest.json"),
        JSON.stringify({
          version: "9.8.8",
          files: [
            {
              path: "Astra.exe",
              sha256: createHash("sha256")
                .update("updated executable fixture")
                .digest("hex"),
            },
          ],
        }),
      );
      writeFileSync(installer, `\uFEFF${windowsInstaller("9.8.8")}`);
      expect(run(installedDirectory)).toContain("Installed Astra 9.8.8");
      expect(readFileSync(installed, "utf8")).toBe(
        "updated executable fixture",
      );
      expect(existsSync(join(installedDirectory, "obsolete.txt"))).toBe(false);
      expect(() => run(local)).toThrow("update destination");
      writeFileSync(join(source, "Astra.exe"), "damaged update");
      expect(() => run(installedDirectory)).toThrow(
        "Astra file verification failed",
      );
      expect(readFileSync(installed, "utf8")).toBe(
        "updated executable fixture",
      );
      expect(readFileSync(profile, "utf8")).toBe(
        "saved apps and conversations",
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  30_000,
);
