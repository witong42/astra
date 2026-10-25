import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appIcon, BRAND_FILES, copyBrand } from "../scripts/icon";

const ICON_PROCESS_TIMEOUT_MS = 20_000;
const ICON_TEST_TIMEOUT_MS = 30_000;

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
      const probe = join(directory, "bounds.cjs");
      writeFileSync(
        probe,
        [
          "const {app,nativeImage}=require('electron');",
          "app.dock?.hide();",
          "app.whenReady().then(()=>{",
          "const image=nativeImage.createFromBuffer(require('node:fs').readFileSync(process.argv[2]));",
          "const {width,height}=image.getSize();const bitmap=image.toBitmap();",
          "const opaque=[];const middle=Math.floor(height/2);",
          "for(let x=0;x<width;x++)if(bitmap[(middle*width+x)*4+3]>=128)opaque.push(x);",
          "console.log(opaque[0]+' '+opaque.at(-1));app.quit();",
          "}).catch(error=>{console.error(error);app.exit(1)});",
        ].join("\n"),
      );
      const environment = { ...process.env };
      delete environment.ELECTRON_RUN_AS_NODE;
      const bounds = execFileSync(
        require("electron"),
        [probe, decoded, `--user-data-dir=${join(directory, "profile")}`],
        {
          encoding: "utf8",
          env: environment,
          timeout: ICON_PROCESS_TIMEOUT_MS,
        },
      );
      expect(bounds.trim()).toBe("100 923");
    } finally {
      rmSync(directory, { recursive: true });
    }
  },
  ICON_TEST_TIMEOUT_MS,
);
