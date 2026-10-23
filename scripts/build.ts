import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { appIcon } from "./icon";

const root = join(import.meta.dir, "..");
const outdir = join(root, "dist");
mkdirSync(outdir, { recursive: true });
if (process.platform === "darwin") {
  execFileSync(
    "xcrun",
    [
      "swiftc",
      "-swift-version",
      "5",
      "-O",
      join(root, "native/Voice.swift"),
      "-o",
      join(outdir, "voice-helper"),
      "-Xlinker",
      "-sectcreate",
      "-Xlinker",
      "__TEXT",
      "-Xlinker",
      "__info_plist",
      "-Xlinker",
      join(root, "native/Voice-Info.plist"),
    ],
    { stdio: "inherit" },
  );
  execFileSync("/usr/bin/codesign", [
    "--force",
    "--sign",
    "-",
    "--identifier",
    "local.codexos.desktop.voice",
    join(outdir, "voice-helper"),
  ]);
}
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
const canvas = await Bun.build({
  entrypoints: [join(root, "src/canvas-runtime.ts")],
  target: "browser",
  format: "iife",
  minify: true,
});
if (!canvas.success)
  throw new AggregateError(canvas.logs, "Canvas build failed");
const runtime = (await canvas.outputs[0].text()).replace(
  /<\/script/gi,
  "<\\/script",
);
await Bun.write(
  join(outdir, "canvas.html"),
  readFileSync(join(root, "src/canvas.html"), "utf8").replace(
    "<!--CANVAS_RUNTIME-->",
    `<script>${runtime}</script>`,
  ),
);
for (const result of [main, renderer])
  if (!result.success)
    throw new AggregateError(result.logs, "Astra build failed");
for (const file of ["index.html", "styles.css"])
  copyFileSync(join(root, "src", file), join(outdir, file));
console.log("Built Astra desktop and renderer.");
const icon = appIcon();
await Bun.write(join(outdir, "icon.png"), icon.png);
await Bun.write(join(outdir, "icon.icns"), icon.icns);
