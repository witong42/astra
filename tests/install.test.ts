import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT = join(import.meta.dir, "..");
const APP_ARCHIVE = "Astra-macos-arm64.zip";
const TEST_TIMEOUT_MS = 15_000;

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "astra-install-test-"));
  const bin = join(directory, "bin");
  const release = join(directory, "release");
  const application = join(release, "Astra.app");
  mkdirSync(bin);
  mkdirSync(join(application, "Contents/MacOS"), { recursive: true });
  copyFileSync("/usr/bin/true", join(application, "Contents/MacOS/Astra"));
  writeFileSync(
    join(application, "Contents/Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>local.codexos.desktop</string><key>CFBundleExecutable</key><string>Astra</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string></dict></plist>`,
  );
  execFileSync("codesign", ["--force", "--sign", "-", application]);
  execFileSync("ditto", [
    "-c",
    "-k",
    "--keepParent",
    application,
    join(release, APP_ARCHIVE),
  ]);
  const digest = new Bun.CryptoHasher("sha256")
    .update(readFileSync(join(release, APP_ARCHIVE)))
    .digest("hex");
  writeFileSync(
    join(release, `${APP_ARCHIVE}.sha256`),
    `${digest}  ${APP_ARCHIVE}\n`,
  );
  writeFileSync(join(release, "release.json"), '{"tag_name":"v0.3.2"}');
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/bash\nset -eu\noutput=""\nurl=""\nwhile [[ $# -gt 0 ]]; do case "$1" in -o) output="$2"; shift 2;; --retry|--connect-timeout|--max-time) shift 2;; --*) shift;; *) url="$1"; shift;; esac; done\ncase "$url" in */releases/latest) file=release.json;; *) file="\${url##*/}";; esac\ncp "$ASTRA_TEST_RELEASE/$file" "$output"\n`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(bin, "pgrep"),
    '#!/bin/sh\nexit "${ASTRA_TEST_RUNNING:-1}"\n',
    { mode: 0o700 },
  );
  writeFileSync(
    join(bin, "uname"),
    '#!/bin/sh\nif [ "$1" = -s ]; then echo Darwin; else echo "${ASTRA_TEST_ARCH:-arm64}"; fi\n',
    { mode: 0o700 },
  );
  const destination = join(directory, "Applications");
  const run = (extra: Record<string, string> = {}) =>
    Bun.spawnSync(["/bin/bash", join(PROJECT, "install.sh")], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        ASTRA_TEST_RELEASE: release,
        ASTRA_INSTALL_DIR: destination,
        ASTRA_NO_OPEN: "1",
        ...extra,
      },
      timeout: TEST_TIMEOUT_MS,
    });
  return { directory, release, destination, run };
}

test.skipIf(process.platform !== "darwin")(
  "installer verifies and installs a signed release, then safely updates it",
  () => {
    const f = fixture();
    try {
      const first = f.run();
      expect({ code: first.exitCode, error: first.stderr.toString() }).toEqual({
        code: 0,
        error: "",
      });
      const installed = join(f.destination, "Astra.app");
      execFileSync("codesign", ["--verify", "--deep", "--strict", installed]);
      const second = f.run();
      expect(second.exitCode).toBe(0);
      expect(second.stdout.toString()).toContain(
        "Your saved apps and Codex configuration were not changed",
      );
      execFileSync("codesign", ["--verify", "--deep", "--strict", installed]);
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);

test.skipIf(process.platform !== "darwin")(
  "installer rejects a corrupt release without replacing the installed app",
  () => {
    const f = fixture();
    try {
      expect(f.run().exitCode).toBe(0);
      const executable = join(f.destination, "Astra.app/Contents/MacOS/Astra");
      const previous = readFileSync(executable);
      writeFileSync(join(f.release, APP_ARCHIVE), "corrupted download");
      const result = f.run();
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("checksum did not match");
      expect(readFileSync(executable).equals(previous)).toBe(true);
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);

test.skipIf(process.platform !== "darwin")(
  "installer rejects an unsupported Mac and a running Astra before downloading",
  () => {
    const f = fixture();
    try {
      const intel = f.run({ ASTRA_TEST_ARCH: "x86_64" });
      expect(intel.exitCode).not.toBe(0);
      expect(intel.stderr.toString()).toContain("Apple Silicon");
      const running = f.run({ ASTRA_TEST_RUNNING: "0" });
      expect(running.exitCode).not.toBe(0);
      expect(running.stderr.toString()).toContain("Quit Astra");
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);
