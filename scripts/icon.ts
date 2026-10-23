import { readFileSync } from "node:fs";
import { join } from "node:path";

const ICON_SIZE = 1024;
const ICNS_HEADER_BYTES = 16;
const ICNS_IMAGE_HEADER_BYTES = 8;
export function appIcon() {
  const png = readFileSync(join(import.meta.dir, "../assets/codexos-icon.png"));
  if (png.readUInt32BE(16) !== ICON_SIZE || png.readUInt32BE(20) !== ICON_SIZE)
    throw new Error("The CodexOS app icon must be a 1024 × 1024 PNG.");
  const header = Buffer.alloc(ICNS_HEADER_BYTES);
  header.write("icns", 0);
  header.writeUInt32BE(png.length + ICNS_HEADER_BYTES, 4);
  header.write("ic10", 8);
  header.writeUInt32BE(png.length + ICNS_IMAGE_HEADER_BYTES, 12);
  return { png, icns: Buffer.concat([header, png]) };
}
