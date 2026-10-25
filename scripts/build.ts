import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { buildCanvas } from "./build-canvas";
import { buildVoice, VOICE_MINIMUM_MACOS } from "./build-voice";
import { appIcon, copyBrand } from "./icon";

const root = join(import.meta.dir, "..");
const outdir = join(root, "dist");
mkdirSync(outdir, { recursive: true });
if (process.platform === "darwin") {
  execFileSync(
    "xcrun",
    [
      "swiftc",
      "-parse-as-library",
      "-swift-version",
      "5",
      "-O",
      "-target",
      `${process.arch === "arm64" ? "arm64" : "x86_64"}-apple-macos${VOICE_MINIMUM_MACOS}`,
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
    "io.github.witong42.astra.voice",
    join(outdir, "voice-helper"),
  ]);
}
const main = await Bun.build({
  entrypoints: [
    join(root, "src/main.ts"),
    join(root, "src/preload.ts"),
    join(root, "src/audio-preload.ts"),
  ],
  outdir,
  target: "node",
  format: "cjs",
  naming: "[name].cjs",
  external: ["electron", "koffi"],
  minify: false,
});
const renderer = await Bun.build({
  entrypoints: [
    join(root, "src/renderer.tsx"),
    join(root, "src/audio-host.ts"),
    join(root, "src/audio-worklet.ts"),
  ],
  outdir,
  target: "browser",
  format: "esm",
  naming: "[name].js",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
const cli = await Bun.build({
  entrypoints: [join(root, "src/astra-cli.ts")],
  outdir,
  target: "node",
  format: "cjs",
  naming: "astra.cjs",
  minify: false,
});
await buildCanvas(root, outdir);
await buildVoice(root, outdir);
for (const result of [main, renderer, cli])
  if (!result.success)
    throw new AggregateError(result.logs, "Astra build failed");
chmodSync(join(outdir, "astra.cjs"), 0o755);
for (const file of ["index.html", "styles.css", "audio-host.html"])
  copyFileSync(join(root, "src", file), join(outdir, file));
copyBrand(root, outdir);
console.log("Built Astra desktop and renderer.");
const icon = appIcon();
await Bun.write(join(outdir, "icon.png"), icon.png);
await Bun.write(join(outdir, "dock.png"), icon.dock);
await Bun.write(join(outdir, "icon.icns"), icon.icns);
