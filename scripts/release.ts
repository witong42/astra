import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

const STABLE_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const MAX_CHECKSUM_BYTES = 1024;

function stableVersion(version: unknown): asserts version is string {
  if (
    typeof version !== "string" ||
    !STABLE_VERSION.test(version) ||
    !version.split(".").map(Number).every(Number.isSafeInteger)
  )
    throw new Error("The release requires a stable numeric version.");
}

export function releaseMetadata(data: unknown, tag?: string) {
  if (
    !data ||
    typeof data !== "object" ||
    !("version" in data) ||
    !("astraBuild" in data)
  )
    throw new Error("The release metadata is missing its version or build.");
  stableVersion(data.version);
  if (
    typeof data.astraBuild !== "number" ||
    !Number.isSafeInteger(data.astraBuild) ||
    data.astraBuild < 1
  )
    throw new Error("The release requires a positive build number.");
  if (tag !== undefined && tag !== `v${data.version}`)
    throw new Error("The Git tag does not match the package version.");
  return { version: data.version, build: data.astraBuild };
}

export function releaseArchives(
  version: string,
  platform?: string,
  architecture?: string,
) {
  stableVersion(version);
  const mac = [`Astra-${version}-macos-arm64.dmg`, "Astra-macos-arm64.zip"];
  const windows = [`Astra-${version}-windows-x64.zip`];
  const linux = (arch: string) => [`Astra-${version}-linux-${arch}.deb`];
  if (platform === undefined)
    return [...mac, ...windows, ...linux("x64"), ...linux("arm64")];
  if (platform === "darwin" && architecture === "arm64") return mac;
  if (platform === "win32" && architecture === "x64") return windows;
  if (
    platform === "linux" &&
    (architecture === "x64" || architecture === "arm64")
  )
    return linux(architecture);
  throw new Error("The release platform or architecture is not supported.");
}

export function assertReleaseAssets(names: string[], version: string) {
  const expected = releaseArchives(version).flatMap((name) => [
    name,
    `${name}.sha256`,
  ]);
  if (
    names.length !== expected.length ||
    new Set(names).size !== expected.length ||
    names.some((name) => !expected.includes(name))
  )
    throw new Error("The release contains missing or unexpected assets.");
}

export async function verifyRelease(
  directory: string,
  version: string,
  platform?: string,
  architecture?: string,
) {
  const selected: string[] = [];
  for (const name of releaseArchives(version, platform, architecture)) {
    const archive = join(directory, name);
    const checksum = `${archive}.sha256`;
    if (
      !(await lstat(archive)).isFile() ||
      !(await lstat(checksum)).isFile() ||
      (await lstat(checksum)).size > MAX_CHECKSUM_BYTES
    )
      throw new Error("The release package or checksum is not a regular file.");
    const match = /^([a-f0-9]{64})[ \t]+\*?([^\r\n]+)\r?\n?$/i.exec(
      await readFile(checksum, "utf8"),
    );
    if (!match || match[2] !== name)
      throw new Error("The release checksum has an unexpected filename.");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(archive)) hash.update(chunk);
    if (hash.digest("hex") !== match[1].toLowerCase())
      throw new Error(`The release checksum did not match: ${name}`);
    selected.push(archive, checksum);
  }
  return selected;
}
