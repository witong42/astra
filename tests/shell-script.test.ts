import { expect, test } from "bun:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runShellScript } from "../src/shell-script";

test("shell actions reject invalid requests and unsupported desktops", async () => {
  await assert.rejects(runShellScript({ script: "" }));
  await assert.rejects(runShellScript({ script: "echo", args: [42] }));
  if (process.platform !== "linux")
    await assert.rejects(runShellScript({ script: "true" }), /require Linux/);
});

test.skipIf(process.platform !== "linux")(
  "Linux shell actions preserve Unicode and shell syntax as literal arguments",
  async () => {
    const args = ["citron vert", "l’été", "$(echo unsafe); ' &", "", "--help"];
    expect(await runShellScript({ script: 'printf "<%s>" "$@"', args })).toBe(
      args.map((value) => `<${value}>`).join(""),
    );
  },
);

test.skipIf(process.platform !== "linux")(
  "Linux shell actions use the selected workspace and reject a missing directory",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "astra shell workspace "));
    try {
      expect(await runShellScript({ script: "pwd" }, directory)).toBe(
        directory,
      );
      await assert.rejects(
        runShellScript({ script: "true" }, join(directory, "missing")),
        /ENOENT/,
      );
      const file = join(directory, "file");
      writeFileSync(file, "fixture");
      await assert.rejects(
        runShellScript({ script: "true" }, file),
        /workspace is not a directory/,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);

test.skipIf(process.platform !== "linux")(
  "Linux shell actions limit concurrent executions and release their slots",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "astra-shell-concurrency-"));
    const release = join(directory, "release");
    const jobs = Array.from({ length: 4 }, (_, index) =>
      runShellScript({
        script:
          'printf ready > "$1"; while [ ! -e "$2" ]; do sleep 0.02; done; printf done',
        args: [join(directory, String(index)), release],
      }),
    );
    try {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (
          jobs.every((_, index) => existsSync(join(directory, String(index))))
        )
          break;
        await Bun.sleep(20);
      }
      expect(
        jobs.every((_, index) => existsSync(join(directory, String(index)))),
      ).toBe(true);
      await assert.rejects(
        runShellScript({ script: "true" }),
        /Four shell actions/,
      );
    } finally {
      writeFileSync(release, "release");
      await Promise.allSettled(jobs);
      rmSync(directory, { recursive: true, force: true });
    }
    expect(await runShellScript({ script: "printf available" })).toBe(
      "available",
    );
  },
);

test.skipIf(process.platform !== "linux")(
  "Linux shell timeout stops descendant processes",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "astra-shell-timeout-"));
    const pidFile = join(directory, "child.pid");
    try {
      await assert.rejects(
        runShellScript({
          script: 'sleep 90 & printf "%s" "$!" > "$1"; wait',
          args: [pidFile],
        }),
        /30 second limit/,
      );
      const pid = Number(readFileSync(pidFile, "utf8"));
      expect(pid).toBeGreaterThan(1);
      for (let attempt = 0; attempt < 100; attempt++) {
        const stat = `/proc/${pid}/stat`;
        if (
          !existsSync(stat) ||
          readFileSync(stat, "utf8").split(") ")[1]?.startsWith("Z")
        )
          return;
        await Bun.sleep(20);
      }
      throw new Error(`Shell descendant ${pid} survived the timeout.`);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  35_000,
);

test.skipIf(process.platform !== "linux")(
  "Linux shell actions stop on command errors and enforce their output bound",
  async () => {
    await assert.rejects(
      runShellScript({ script: 'printf "action failed" >&2; exit 7' }),
      /action failed/,
    );
    await assert.rejects(
      runShellScript({ script: 'false; printf "must not succeed"' }),
    );
    await assert.rejects(
      runShellScript({ script: 'while :; do printf "%0100d" 0; done' }),
      /64 KB/,
    );
  },
);
