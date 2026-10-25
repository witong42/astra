import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const output = join(homedir(), ".astra/media/getastra-screenshots");
const assets = join(root, ".github/assets");
const CAPTURE_TIMEOUT_MS = 120_000;
mkdirSync(output, { recursive: true, mode: 0o700 });
mkdirSync(assets, { recursive: true });
const config = join(output, "capture.json");
writeFileSync(config, JSON.stringify({ root, output, assets }));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
execFileSync(
  join(root, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron"),
  [join(root, "website/media/render.cjs"), config],
  { env, stdio: "inherit", timeout: CAPTURE_TIMEOUT_MS },
);
console.log(`Captured the marketing gallery in ${assets}.`);
