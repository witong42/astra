import { join } from "node:path";
import type { SiteAssets } from "../src/site-worker";

const FILES = [
  ["index.html", "text/html; charset=utf-8"],
  ["canvas.html", "text/html; charset=utf-8"],
  ["web.js", "text/javascript; charset=utf-8"],
  ["audio-worklet.js", "text/javascript; charset=utf-8"],
  ["styles.css", "text/css; charset=utf-8"],
  ["web.css", "text/css; charset=utf-8"],
  ["icon.png", "image/png"],
] as const;

export async function buildSiteWorker(assetDirectory: string, outdir: string) {
  const assets: SiteAssets = {};
  for (const [name, contentType] of FILES) {
    const file = Bun.file(join(assetDirectory, name));
    if (!(await file.exists()))
      throw new Error(`Missing Astra web asset: ${name}`);
    assets[`/${name}`] =
      contentType === "image/png"
        ? {
            body: Buffer.from(await file.arrayBuffer()).toString("base64"),
            contentType,
            encoding: "base64",
          }
        : { body: await file.text(), contentType };
  }
  const result = await Bun.build({
    entrypoints: [join(import.meta.dir, "../src/site-worker.ts")],
    outdir,
    target: "browser",
    format: "esm",
    naming: "index.js",
    minify: true,
    define: { __ASTRA_SITE_ASSETS__: JSON.stringify(assets) },
  });
  if (!result.success)
    throw new AggregateError(result.logs, "Astra Site response build failed");
}
