import { copyFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ICON_SIZE = 1024;
const ICNS_HEADER_BYTES = 16;
const ICNS_IMAGE_HEADER_BYTES = 8;
export const BRAND_FILES = [
  "astra-logo.svg",
  "brand.css",
  "outfit.ttf",
  "OFL-Outfit.txt",
] as const;

export function copyBrand(root: string, outdir: string) {
  for (const file of BRAND_FILES)
    copyFileSync(join(root, "assets", file), join(outdir, file));
}

export function appIcon() {
  const png = readFileSync(join(import.meta.dir, "../assets/astra-icon.png"));
  const dock = readFileSync(
    join(import.meta.dir, "../assets/astra-dock-icon.png"),
  );
  for (const image of [png, dock])
    if (
      image.readUInt32BE(16) !== ICON_SIZE ||
      image.readUInt32BE(20) !== ICON_SIZE
    )
      throw new Error("The Astra app icons must be 1024 × 1024 PNGs.");
  const header = Buffer.alloc(ICNS_HEADER_BYTES);
  header.write("icns", 0);
  header.writeUInt32BE(dock.length + ICNS_HEADER_BYTES, 4);
  header.write("ic10", 8);
  header.writeUInt32BE(dock.length + ICNS_IMAGE_HEADER_BYTES, 12);
  return { png, dock, icns: Buffer.concat([header, dock]) };
}
