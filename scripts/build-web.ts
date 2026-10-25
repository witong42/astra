import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCanvas } from "./build-canvas";
import { buildSiteWorker } from "./build-site-worker";
import { appIcon, copyBrand } from "./icon";

const root = join(import.meta.dir, "..");
const outdir = join(root, "dist/client");
const { version, astraBuild } = JSON.parse(
  readFileSync(join(root, "package.json"), "utf8"),
) as { version: string; astraBuild: number };
const remote = process.env.ASTRA_REMOTE_URL;
if (!remote)
  throw new Error(
    "Set ASTRA_REMOTE_URL to your desktop's HTTPS origin before building the phone client. See README.md#phone-access.",
  );
const url = new URL(remote);
const loopback =
  url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
if (
  url.origin !== remote ||
  (url.protocol !== "https:" && !loopback) ||
  url.username ||
  url.password
)
  throw new Error(
    "ASTRA_REMOTE_URL must be one exact HTTPS origin, or HTTP loopback for local testing.",
  );
mkdirSync(outdir, { recursive: true });
const result = await Bun.build({
  entrypoints: [join(root, "src/web.ts"), join(root, "src/audio-worklet.ts")],
  outdir,
  target: "browser",
  format: "esm",
  naming: "[name].js",
  minify: true,
  define: {
    "process.env.NODE_ENV": '"production"',
    __ASTRA_REMOTE_URL__: JSON.stringify(remote),
  },
});
if (!result.success)
  throw new AggregateError(result.logs, "Astra web build failed");
await buildCanvas(root, outdir);
const html = readFileSync(join(root, "src/index.html"), "utf8")
  .replace(
    "connect-src 'none'",
    `connect-src ${remote}; worker-src 'self'; media-src 'self' blob:`,
  )
  .replace('src="./renderer.js"', 'src="./web.js"')
  .replace(
    'content="width=device-width, initial-scale=1.0"',
    'content="width=device-width, initial-scale=1.0, viewport-fit=cover"',
  )
  .replace(
    "</head>",
    `<meta name="application-version" content="${version}" /><meta name="astra-build" content="${astraBuild}" /><meta name="theme-color" content="#090a10" /><link rel="icon" href="./icon.png" /><link rel="apple-touch-icon" href="./icon.png" /><link rel="stylesheet" href="./web.css" /></head>`,
  );
await Bun.write(join(outdir, "index.html"), html);
for (const file of ["styles.css", "web.css"])
  copyFileSync(join(root, "src", file), join(outdir, file));
copyBrand(root, outdir);
await Bun.write(join(outdir, "icon.png"), appIcon().png);
await buildSiteWorker(outdir, join(root, "dist/server"));
console.log(`Built Astra web for ${remote}.`);
