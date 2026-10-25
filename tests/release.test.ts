import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
