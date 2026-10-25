import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appIcon, BRAND_FILES, copyBrand } from "../scripts/icon";

test("branding ships the same offline font, artwork and license to every client", () => {
  const directory = mkdtempSync(join(tmpdir(), "astra-brand-test-"));
  try {
    const root = join(import.meta.dir, "..");
    copyBrand(root, directory);
    for (const file of BRAND_FILES)
      expect(readFileSync(join(directory, file))).toEqual(
        readFileSync(join(root, "assets", file)),
      );
    expect(
      readFileSync(join(directory, "outfit.ttf")).byteLength,
    ).toBeGreaterThan(0);
    expect(readFileSync(join(directory, "OFL-Outfit.txt"), "utf8")).toContain(
      "SIL OPEN FONT LICENSE",
    );
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test.skipIf(process.platform !== "darwin")(
  "the approved app artwork builds into an icon macOS can decode with transparency",
  () => {
    const directory = mkdtempSync(join(tmpdir(), "astra-icon-test-"));
    try {
      const { png, dock, icns } = appIcon();
      expect(png).toEqual(
        readFileSync(join(import.meta.dir, "../assets/astra-icon.png")),
      );
      expect(icns.subarray(16)).toEqual(dock);
      const path = join(directory, "icon.icns");
      const output = join(directory, "icon.iconset");
      writeFileSync(path, icns);
      execFileSync("/usr/bin/iconutil", [
        "--convert",
        "iconset",
        path,
        "--output",
        output,
      ]);
      const decoded = join(output, "icon_512x512@2x.png");
      const information = execFileSync(
        "/usr/bin/sips",
        ["-g", "pixelWidth", "-g", "pixelHeight", "-g", "hasAlpha", decoded],
        { encoding: "utf8" },
      );
      expect(information).toContain("pixelWidth: 1024");
      expect(information).toContain("pixelHeight: 1024");
      expect(information).toContain("hasAlpha: yes");
      const bounds = execFileSync(
        "/usr/bin/swift",
        [
          "-e",
          String.raw`import AppKit
import Foundation
let data = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments.last!))
let image = NSBitmapImageRep(data: data)!
let middle = image.pixelsHigh / 2
let opaque = (0..<image.pixelsWide).filter { (image.colorAt(x: $0, y: middle)?.alphaComponent ?? 0) >= 0.5 }
print("\(opaque.first ?? -1) \(opaque.last ?? -1)")`,
          decoded,
        ],
        { encoding: "utf8" },
      );
      expect(bounds.trim()).toBe("100 923");
    } finally {
      rmSync(directory, { recursive: true });
    }
  },
);
