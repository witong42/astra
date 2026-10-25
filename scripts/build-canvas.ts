import { readFileSync } from "node:fs";
import { join } from "node:path";

export async function buildCanvas(root: string, outdir: string) {
  const brand = readFileSync(join(root, "assets/brand.css"), "utf8").replace(
    "./outfit.ttf",
    `data:font/ttf;base64,${readFileSync(join(root, "assets/outfit.ttf")).toString("base64")}`,
  );
  const result = await Bun.build({
    entrypoints: [join(root, "src/canvas-runtime.ts")],
    target: "browser",
    format: "iife",
    minify: true,
  });
  if (!result.success)
    throw new AggregateError(result.logs, "Canvas build failed");
  const runtime = (await result.outputs[0].text()).replace(
    /<\/script/gi,
    "<\\/script",
  );
  await Bun.write(
    join(outdir, "canvas.html"),
    readFileSync(join(root, "src/canvas.html"), "utf8")
      .replace("<!--BRAND_STYLE-->", `<style>${brand}</style>`)
      .replace("<!--CANVAS_RUNTIME-->", `<script>${runtime}</script>`),
  );
}
