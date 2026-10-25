import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";

export function packageMacArchives(
  application: string,
  release: string,
  version: string,
) {
  if (process.platform !== "darwin" || process.arch !== "arm64")
    throw new Error("Build macOS release archives on an Apple Silicon Mac.");
  const imageName = `Astra-${version}-macos-arm64.dmg`;
  const zipName = "Astra-macos-arm64.zip";
  for (const name of [imageName, zipName])
    for (const suffix of ["", ".sha256"])
      if (existsSync(join(release, name + suffix)))
        throw new Error(
          `${name + suffix} already exists. Increase the release version.`,
        );
  const bundleVersion = execFileSync(
    "/usr/libexec/PlistBuddy",
    [
      "-c",
      "Print :CFBundleShortVersionString",
      join(application, "Contents/Info.plist"),
    ],
    { encoding: "utf8" },
  ).trim();
  if (bundleVersion !== version)
    throw new Error(
      `Expected Astra ${version}; the app contains ${bundleVersion}.`,
    );
  execFileSync("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    application,
  ]);
  mkdirSync(release, { recursive: true });
  const temporary = mkdtempSync(join(release, ".macos-package-"));
  try {
    const staging = join(temporary, "volume");
    mkdirSync(staging);
    execFileSync("/usr/bin/ditto", [application, join(staging, "Astra.app")]);
    symlinkSync("/Applications", join(staging, "Applications"));
    const image = join(temporary, imageName);
    execFileSync("/usr/bin/hdiutil", [
      "create",
      "-volname",
      "Astra",
      "-srcfolder",
      staging,
      "-fs",
      "HFS+",
      "-format",
      "UDZO",
      image,
    ]);
    execFileSync("/usr/bin/hdiutil", ["verify", image]);
    const zip = join(temporary, zipName);
    execFileSync("/usr/bin/ditto", [
      "-c",
      "-k",
      "--sequesterRsrc",
      "--keepParent",
      application,
      zip,
    ]);
    for (const archive of [image, zip]) {
      const digest = createHash("sha256")
        .update(readFileSync(archive))
        .digest("hex");
      writeFileSync(`${archive}.sha256`, `${digest}  ${basename(archive)}\n`);
    }
    for (const archive of [image, zip])
      for (const suffix of ["", ".sha256"])
        renameSync(archive + suffix, join(release, basename(archive) + suffix));
    return join(release, imageName);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}
