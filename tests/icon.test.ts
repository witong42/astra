import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appIcon } from "../scripts/icon";

test.skipIf(process.platform !== "darwin")(
  "the approved app artwork builds into an icon macOS can decode with transparency",
  () => {
    const directory = mkdtempSync(join(tmpdir(), "codexos-icon-test-"));
    try {
      const { png, icns } = appIcon();
      expect(png).toEqual(
        readFileSync(join(import.meta.dir, "../assets/codexos-icon.png")),
      );
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
    } finally {
      rmSync(directory, { recursive: true });
    }
  },
);
