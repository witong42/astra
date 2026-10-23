import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { appIcon } from "./icon";

const root = join(import.meta.dir, "..");
const outdir = join(root, "dist");
mkdirSync(outdir, { recursive: true });
const main = await Bun.build({
  entrypoints: [join(root, "src/main.ts"), join(root, "src/preload.ts")],
  outdir,
  target: "node",
  format: "cjs",
  naming: "[name].cjs",
  external: ["electron"],
  define: { __PROJECT_ROOT__: JSON.stringify(root) },
  minify: false,
});
const renderer = await Bun.build({
  entrypoints: [join(root, "src/renderer.tsx")],
  outdir,
  target: "browser",
  format: "esm",
  naming: "[name].js",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
for (const result of [main, renderer])
  if (!result.success)
    throw new AggregateError(result.logs, "CodexOS build failed");
for (const file of ["index.html", "styles.css"])
  copyFileSync(join(root, "src", file), join(outdir, file));
console.log("Built CodexOS desktop and renderer.");
const icon = appIcon();
await Bun.write(join(outdir, "icon.png"), icon.png);
await Bun.write(join(outdir, "icon.icns"), icon.icns);
