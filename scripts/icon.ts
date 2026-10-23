import { deflateSync } from "node:zlib";

const SIZE = 512;
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(name: string, data: Buffer) {
  const type = Buffer.from(name);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(Bun.hash.crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}
function segmentDistance(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  const fraction = Math.max(
    0,
    Math.min(
      1,
      ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) /
        ((bx - ax) ** 2 + (by - ay) ** 2),
    ),
  );
  return Math.hypot(
    x - ax - fraction * (bx - ax),
    y - ay - fraction * (by - ay),
  );
}
export function appIcon() {
  const pixels = Buffer.alloc(SIZE * (SIZE * 4 + 1));
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const u = (x + 0.5) / SIZE;
      const v = (y + 0.5) / SIZE;
      const dx = Math.abs(u - 0.5) - 0.25;
      const dy = Math.abs(v - 0.5) - 0.25;
      const edge =
        Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) +
        Math.min(Math.max(dx, dy), 0) -
        0.19;
      const alpha = Math.round(Math.max(0, Math.min(1, -edge * SIZE)) * 255);
      const chevron =
        Math.min(
          segmentDistance(u, v, 0.26, 0.35, 0.46, 0.5),
          segmentDistance(u, v, 0.46, 0.5, 0.26, 0.65),
        ) < 0.025;
      const cursor = segmentDistance(u, v, 0.55, 0.65, 0.75, 0.65) < 0.025;
      const color = chevron
        ? [234, 237, 225]
        : cursor
          ? [205, 126, 83]
          : [33, 36, 30];
      const offset = y * (SIZE * 4 + 1) + 1 + x * 4;
      pixels[offset] = color[0];
      pixels[offset + 1] = color[1];
      pixels[offset + 2] = color[2];
      pixels[offset + 3] = alpha;
    }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(SIZE, 0);
  header.writeUInt32BE(SIZE, 4);
  header[8] = 8;
  header[9] = 6;
  const png = Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  const icnsHeader = Buffer.alloc(16);
  icnsHeader.write("icns", 0);
  icnsHeader.writeUInt32BE(png.length + 16, 4);
  icnsHeader.write("ic09", 8);
  icnsHeader.writeUInt32BE(png.length + 8, 12);
  return { png, icns: Buffer.concat([icnsHeader, png]) };
}
