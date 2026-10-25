import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROJECT = join(import.meta.dir, "..");
const APP_ARCHIVE = "Astra-macos-arm64.zip";
const TEST_TIMEOUT_MS = 30_000;
const BUNDLE_ID = "io.github.witong42.astra";
const LEGACY_BUNDLE_ID = "local.astra.desktop";

function fixture(identifier = BUNDLE_ID) {
  const directory = mkdtempSync(join(tmpdir(), "astra-install-test-"));
  const bin = join(directory, "bin");
  const release = join(directory, "release");
  const application = join(release, "Astra.app");
  mkdirSync(bin);
  mkdirSync(join(application, "Contents/MacOS"), { recursive: true });
  copyFileSync("/usr/bin/true", join(application, "Contents/MacOS/Astra"));
  writeFileSync(
    join(application, "Contents/Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${identifier}</string><key>CFBundleExecutable</key><string>Astra</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>0.3.2</string><key>CFBundleVersion</key><string>1</string></dict></plist>`,
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
    `#!/bin/sh\nexit "\${ASTRA_TEST_RUNNING:-1}"\n`,
    { mode: 0o700 },
  );
  writeFileSync(
    join(bin, "uname"),
    `#!/bin/sh\nif [ "$1" = -s ]; then echo Darwin; else echo "\${ASTRA_TEST_ARCH:-arm64}"; fi\n`,
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

const LINUX_VERSION = "0.5.1";
const LINUX_ARCHIVE = `Astra-${LINUX_VERSION}-linux-arm64.deb`;

function linuxFixture(architecture: "arm64" | "x64" = "arm64") {
  const linuxArchive = `Astra-${LINUX_VERSION}-linux-${architecture}.deb`;
  const debianArchitecture = architecture === "x64" ? "amd64" : "arm64";
  const directory = mkdtempSync(join(tmpdir(), "astra Linux install "));
  const bin = join(directory, "bin");
  const release = join(directory, "release");
  const profile = join(directory, "profile");
  const log = join(directory, "commands.jsonl");
  mkdirSync(bin);
  mkdirSync(release);
  mkdirSync(profile);
  writeFileSync(join(profile, "workspace.json"), '{"preserved":true}');
  writeFileSync(join(release, linuxArchive), "Linux release fixture");
  const digest = new Bun.CryptoHasher("sha256")
    .update(readFileSync(join(release, linuxArchive)))
    .digest("hex");
  writeFileSync(
    join(release, `${linuxArchive}.sha256`),
    `${digest}  ${linuxArchive}\n`,
  );
  for (const command of ["cp", "rm", "mktemp", "chmod"])
    symlinkSync(Bun.which(command) ?? command, join(bin, command));
  symlinkSync(process.execPath, join(bin, "bun"));
  const script = `#!/usr/bin/env bun
import {appendFileSync,copyFileSync,readFileSync} from 'node:fs';
import {basename,join} from 'node:path';
const name=basename(process.argv[1]);const args=process.argv.slice(2);const env=process.env;
const record=()=>appendFileSync(env.ASTRA_TEST_LOG,JSON.stringify({name,args})+'\\n');
if(name==='uname'){console.log(args[0]==='-s'?(env.ASTRA_TEST_OS??'Linux'):(env.ASTRA_TEST_ARCH??'${architecture === "x64" ? "x86_64" : "aarch64"}'));}
else if(name==='id'){console.log(env.ASTRA_TEST_UID??'1000');}
else if(name==='pgrep'){process.exit(Number(env.ASTRA_TEST_RUNNING??'1'));}
else if(name==='dpkg'){console.log(env.ASTRA_TEST_DPKG_ARCH??'${debianArchitecture}');}
else if(name==='dpkg-deb'){
const field=args.at(-1);console.log(field==='Package'?(env.ASTRA_TEST_PACKAGE_NAME??'astra'):field==='Architecture'?(env.ASTRA_TEST_PACKAGE_ARCH??'${debianArchitecture}'):(env.ASTRA_TEST_PACKAGE_VERSION??'${LINUX_VERSION}-16'));
}
else if(name==='sha256sum'){console.log(new Bun.CryptoHasher('sha256').update(readFileSync(args[0])).digest('hex')+'  '+args[0]);}
else if(name==='curl'){
record();if(args.includes('--write-out'))console.log(env.ASTRA_TEST_RELEASE_URL??'https://github.com/witong42/astra/releases/tag/v${LINUX_VERSION}');
else{const output=args[args.indexOf('-o')+1];const file=args.at(-1).split('/').at(-1);copyFileSync(join(env.ASTRA_TEST_RELEASE,file),output);}
}
else if(name==='sudo'||name==='pkexec'){record();const child=Bun.spawnSync(args,{env,stdout:'inherit',stderr:'inherit'});process.exit(child.exitCode);}
else if(name==='apt-get'){record();process.exit(Number(env.ASTRA_TEST_APT_EXIT??'0'));}
`;
  for (const command of [
    "uname",
    "id",
    "pgrep",
    "dpkg",
    "dpkg-deb",
    "sha256sum",
    "curl",
    "sudo",
    "pkexec",
    "apt-get",
  ])
    writeFileSync(join(bin, command), script, { mode: 0o700 });
  const run = (extra: Record<string, string | undefined> = {}) =>
    Bun.spawnSync(["/bin/bash"], {
      stdin: readFileSync(join(PROJECT, "install.sh")),
      env: {
        ...process.env,
        PATH: bin,
        TMPDIR: directory,
        ASTRA_TEST_RELEASE: release,
        ASTRA_TEST_LOG: log,
        ASTRA_DATA_DIR: profile,
        ...extra,
      },
      timeout: TEST_TIMEOUT_MS,
    });
  const commands = () =>
    existsSync(log)
      ? readFileSync(log, "utf8")
          .trim()
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as { name: string; args: string[] })
      : [];
  return { directory, bin, release, profile, run, commands, linuxArchive };
}

for (const architecture of ["arm64", "x64"] as const)
  test.skipIf(process.platform === "win32")(
    `Linux ${architecture} in-app updates reuse the downloaded package and request graphical authorization`,
    () => {
      const f = linuxFixture(architecture);
      try {
        const result = f.run({
          ASTRA_UPDATE_ARCHIVE: join(f.release, f.linuxArchive),
          ASTRA_UPDATE_VERSION: `v${LINUX_VERSION}`,
          ASTRA_UPDATE_GUI: "1",
        });
        expect({
          code: result.exitCode,
          error: result.stderr.toString(),
        }).toEqual({ code: 0, error: "" });
        expect(f.commands().map((entry) => entry.name)).toEqual([
          "pkexec",
          "apt-get",
        ]);
        expect(readFileSync(join(f.profile, "workspace.json"), "utf8")).toBe(
          '{"preserved":true}',
        );
      } finally {
        rmSync(f.directory, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

for (const architecture of ["arm64", "x64"] as const)
  test.skipIf(process.platform === "win32")(
    `the same piped installer verifies Linux ${architecture} and invokes APT through sudo`,
    () => {
      const f = linuxFixture(architecture);
      try {
        const result = f.run();
        expect({
          code: result.exitCode,
          error: result.stderr.toString(),
        }).toEqual({ code: 0, error: "" });
        const apt = f.commands().find((x) => x.name === "apt-get");
        expect(apt?.args.slice(0, 2)).toEqual(["install", "-y"]);
        expect(apt?.args.at(-1)).toEndWith(`/${f.linuxArchive}`);
        expect(f.commands().filter((x) => x.name === "sudo")).toHaveLength(1);
        expect(readFileSync(join(f.profile, "workspace.json"), "utf8")).toBe(
          '{"preserved":true}',
        );
        expect(existsSync(apt?.args.at(-1) ?? "")).toBe(false);
        expect(result.stdout.toString()).toContain("applications menu");
      } finally {
        rmSync(f.directory, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );

test.skipIf(process.platform === "win32")(
  "Linux validation rejects corrupt downloads and wrong package identity before elevation",
  () => {
    for (const extra of [
      { corrupt: true },
      { ASTRA_TEST_PACKAGE_NAME: "other" },
      { ASTRA_TEST_PACKAGE_ARCH: "amd64" },
      { ASTRA_TEST_PACKAGE_VERSION: "9.9.9-1" },
      { ASTRA_TEST_PACKAGE_VERSION: `${LINUX_VERSION}-bad` },
    ]) {
      const f = linuxFixture();
      try {
        if ("corrupt" in extra)
          writeFileSync(join(f.release, LINUX_ARCHIVE), "corrupt");
        const result = f.run("corrupt" in extra ? {} : extra);
        expect(result.exitCode).not.toBe(0);
        expect(
          f.commands().some((x) => x.name === "sudo" || x.name === "apt-get"),
        ).toBe(false);
      } finally {
        rmSync(f.directory, { recursive: true, force: true });
      }
    }
  },
  TEST_TIMEOUT_MS,
);

test.skipIf(process.platform === "win32")(
  "Linux rejects unsupported hosts and running Astra before downloading",
  () => {
    for (const extra of [
      { ASTRA_TEST_ARCH: "riscv64" },
      { ASTRA_TEST_DPKG_ARCH: "amd64" },
      { ASTRA_TEST_RUNNING: "0" },
      { ASTRA_TEST_OS: "MINGW64_NT-10.0" },
    ]) {
      const f = linuxFixture();
      try {
        expect(f.run(extra).exitCode).not.toBe(0);
        expect(f.commands()).toEqual([]);
      } finally {
        rmSync(f.directory, { recursive: true, force: true });
      }
    }
  },
  TEST_TIMEOUT_MS,
);

test.skipIf(process.platform === "win32")(
  "Linux requires APT and sudo when needed, handles root and reports install failure",
  () => {
    for (const scenario of ["no-apt", "no-sudo", "root", "apt-fails"]) {
      const f = linuxFixture();
      try {
        if (scenario === "no-apt") rmSync(join(f.bin, "apt-get"));
        if (scenario === "no-sudo") rmSync(join(f.bin, "sudo"));
        const result = f.run(
          scenario === "root"
            ? { ASTRA_TEST_UID: "0" }
            : scenario === "apt-fails"
              ? { ASTRA_TEST_APT_EXIT: "100" }
              : {},
        );
        expect(result.exitCode).toBe(scenario === "root" ? 0 : 1);
        if (scenario === "root")
          expect(f.commands().some((x) => x.name === "sudo")).toBe(false);
        if (scenario.startsWith("no-")) expect(f.commands()).toEqual([]);
        if (scenario === "apt-fails")
          expect(result.stdout.toString()).not.toContain("is installed");
      } finally {
        rmSync(f.directory, { recursive: true, force: true });
      }
    }
  },
  TEST_TIMEOUT_MS,
);

test.skipIf(process.platform === "win32")(
  "Linux rejects an unexpected release redirect and checksum filename",
  () => {
    for (const scenario of ["redirect", "checksum"]) {
      const f = linuxFixture();
      try {
        if (scenario === "checksum") {
          const path = join(f.release, `${LINUX_ARCHIVE}.sha256`);
          writeFileSync(
            path,
            readFileSync(path, "utf8").replace(LINUX_ARCHIVE, "other.deb"),
          );
        }
        const result = f.run(
          scenario === "redirect"
            ? {
                ASTRA_TEST_RELEASE_URL:
                  "https://example.com/releases/tag/v0.5.1",
              }
            : {},
        );
        expect(result.exitCode).not.toBe(0);
        expect(
          f.commands().some((x) => x.name === "sudo" || x.name === "apt-get"),
        ).toBe(false);
      } finally {
        rmSync(f.directory, { recursive: true, force: true });
      }
    }
  },
  TEST_TIMEOUT_MS,
);

test.skipIf(process.platform !== "darwin")(
  "an in-app update installs its already verified release offline and retains the previous bundle",
  () => {
    const f = fixture();
    try {
      expect(f.run().exitCode).toBe(0);
      rmSync(join(f.release, "release.json"));
      const result = f.run({
        ASTRA_UPDATE_ARCHIVE: join(f.release, APP_ARCHIVE),
        ASTRA_UPDATE_VERSION: "v0.3.2",
      });
      expect({
        code: result.exitCode,
        error: result.stderr.toString(),
      }).toEqual({ code: 0, error: "" });
      for (const app of [
        join(f.destination, "Astra.app"),
        join(f.release, "previous.app"),
      ])
        execFileSync("codesign", ["--verify", "--deep", "--strict", app]);
      const mismatch = f.run({
        ASTRA_UPDATE_ARCHIVE: join(f.release, APP_ARCHIVE),
        ASTRA_UPDATE_VERSION: "v0.6.0",
      });
      expect(mismatch.exitCode).not.toBe(0);
      expect(mismatch.stderr.toString()).toContain("version");
    } finally {
      rmSync(f.directory, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);

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

test.skipIf(process.platform !== "darwin")(
  "installer migrates a signed legacy Astra bundle to the GitHub identity and prevents an identity downgrade",
  () => {
    const current = fixture();
    const legacy = fixture(LEGACY_BUNDLE_ID);
    try {
      expect(current.run({ ASTRA_TEST_RELEASE: legacy.release }).exitCode).toBe(
        0,
      );
      expect(current.run().exitCode).toBe(0);
      const installed = join(current.destination, "Astra.app");
      const identifier = () =>
        execFileSync(
          "/usr/bin/plutil",
          [
            "-extract",
            "CFBundleIdentifier",
            "raw",
            "-o",
            "-",
            join(installed, "Contents/Info.plist"),
          ],
          { encoding: "utf8" },
        ).trim();
      expect(identifier()).toBe(BUNDLE_ID);
      const downgrade = current.run({ ASTRA_TEST_RELEASE: legacy.release });
      expect(downgrade.exitCode).not.toBe(0);
      expect(downgrade.stderr.toString()).toContain("previous identity");
      expect(identifier()).toBe(BUNDLE_ID);
      execFileSync("codesign", ["--verify", "--deep", "--strict", installed]);
    } finally {
      rmSync(current.directory, { recursive: true, force: true });
      rmSync(legacy.directory, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);

test.skipIf(process.platform !== "darwin")(
  "installer rejects signed applications outside both Astra identities",
  () => {
    const valid = fixture();
    const unrelated = fixture("com.example.unrelated");
    try {
      const result = valid.run({ ASTRA_TEST_RELEASE: unrelated.release });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("wrong identity");
    } finally {
      rmSync(valid.directory, { recursive: true, force: true });
      rmSync(unrelated.directory, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);
