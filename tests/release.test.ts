import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runInNewContext } from "node:vm";
import {
  assertReleaseAssets,
  releaseArchives,
  releaseMetadata,
  verifyRelease,
} from "../scripts/release";

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

test("Windows checkouts preserve native cache input bytes and binary voice fixtures", () => {
  const directory = mkdtempSync(join(tmpdir(), "astra-checkout-test-"));
  temporary.push(directory);
  const source = join(directory, "source");
  const checkout = join(directory, "checkout");
  mkdirSync(source);
  mkdirSync(checkout);
  const files = [
    "scripts/build-voice-windows.ts",
    "native/VoskWindows.Dockerfile",
    "src/vosk.ts",
    "tests/fixtures/voice/en-astra.wav",
  ];
  for (const file of files) {
    const destination = join(source, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(new URL(`../${file}`, import.meta.url), destination);
  }
  const attributes = new URL("../.gitattributes", import.meta.url);
  const staged = [...files];
  if (existsSync(attributes)) {
    copyFileSync(attributes, join(source, ".gitattributes"));
    staged.push(".gitattributes");
  }
  const git = (args: string[]) =>
    execFileSync("git", ["-C", source, "-c", "core.autocrlf=true", ...args], {
      stdio: "pipe",
    });
  git(["init"]);
  git(["add", "--", ...staged]);
  git([
    "checkout-index",
    `--prefix=${checkout.replaceAll("\\", "/")}/`,
    "--",
    ...files,
  ]);
  for (const file of files)
    expect({
      file,
      sha256: createHash("sha256")
        .update(readFileSync(join(checkout, file)))
        .digest("hex"),
    }).toEqual({
      file,
      sha256: createHash("sha256")
        .update(readFileSync(new URL(`../${file}`, import.meta.url)))
        .digest("hex"),
    });
});

test.each([
  ["push", "refs/tags/v0.6.0", true],
  ["workflow_dispatch", "refs/tags/v0.6.0", false],
  ["workflow_dispatch", "refs/heads/main", false],
  ["pull_request", "refs/pull/1/merge", false],
  ["push", "refs/heads/main", false],
] as const)(
  "publication is restricted to an actual tag push (%s %s)",
  (event, ref, expected) => {
    const workflow = Bun.YAML.parse(
      readFileSync(
        new URL("../.github/workflows/check.yml", import.meta.url),
        "utf8",
      ),
    ) as {
      jobs: Record<
        string,
        { if: string; steps: { env?: Record<string, string> }[] }
      >;
    };
    const context = {
      github: { event_name: event, ref },
      startsWith: (value: string, prefix: string) => value.startsWith(prefix),
    };
    for (const name of ["draft", "publish"])
      expect(runInNewContext(workflow.jobs[name].if, context)).toBe(expected);
    const flag = workflow.jobs.packages.steps.find(
      (step) => step.env?.PUBLISH_RELEASE,
    )?.env?.PUBLISH_RELEASE;
    expect(typeof flag).toBe("string");
    expect(
      runInNewContext(
        flag?.replace(/^\$\{\{\s*|\s*\}\}$/g, "") ?? "undefined",
        context,
      ),
    ).toBe(expected);
  },
);

test("release identity matches a stable tag and a positive build", () => {
  expect(
    releaseMetadata({ version: "0.6.0", astraBuild: 17 }, "v0.6.0"),
  ).toEqual({ version: "0.6.0", build: 17 });
  expect(() =>
    releaseMetadata({ version: "0.6.0", astraBuild: 17 }, "v0.6.1"),
  ).toThrow("tag");
  expect(() => releaseMetadata({ version: "0.6.0", astraBuild: 0 })).toThrow(
    "build",
  );
  expect(() =>
    releaseMetadata({ version: "0.6.0-rc.1", astraBuild: 17 }),
  ).toThrow("stable");
});

test("the release contract covers all current platforms without widening architecture support", () => {
  expect(releaseArchives("0.6.0")).toHaveLength(5);
  expect(releaseArchives("0.6.0", "darwin", "arm64")).toEqual([
    "Astra-0.6.0-macos-arm64.dmg",
    "Astra-macos-arm64.zip",
  ]);
  expect(releaseArchives("0.6.0", "win32", "x64")).toEqual([
    "Astra-0.6.0-windows-x64.zip",
  ]);
  expect(releaseArchives("0.6.0", "linux", "arm64")).toEqual([
    "Astra-0.6.0-linux-arm64.deb",
  ]);
  expect(releaseArchives("0.6.0", "linux", "x64")).toEqual([
    "Astra-0.6.0-linux-x64.deb",
  ]);
  expect(() => releaseArchives("0.6.0", "darwin", "x64")).toThrow("supported");
});

test("publication verifies every package and checksum and selects only release assets", async () => {
  const directory = mkdtempSync(join(tmpdir(), "astra-release-contract-"));
  temporary.push(directory);
  for (const name of releaseArchives("0.6.0")) {
    const bytes = Buffer.from(`artifact ${name}`);
    writeFileSync(join(directory, name), bytes);
    writeFileSync(
      join(directory, `${name}.sha256`),
      `${createHash("sha256").update(bytes).digest("hex")}  ${name}\n`,
    );
  }
  writeFileSync(join(directory, "private-backup.zip"), "must not be published");
  const assets = await verifyRelease(directory, "0.6.0");
  const names = releaseArchives("0.6.0").flatMap((name) => [
    name,
    `${name}.sha256`,
  ]);
  assertReleaseAssets(names, "0.6.0");
  expect(() =>
    assertReleaseAssets([...names, "private-backup.zip"], "0.6.0"),
  ).toThrow("unexpected");
  expect(() => assertReleaseAssets(names.slice(1), "0.6.0")).toThrow("missing");
  expect(assets).toHaveLength(10);
  expect(assets).not.toContain(join(directory, "private-backup.zip"));
  const archive = join(directory, "Astra-0.6.0-linux-x64.deb");
  const original = readFileSync(archive);
  writeFileSync(archive, "corrupt");
  await expect(verifyRelease(directory, "0.6.0")).rejects.toThrow("checksum");
  writeFileSync(archive, original);
  rmSync(`${archive}.sha256`);
  await expect(verifyRelease(directory, "0.6.0")).rejects.toThrow();
});
