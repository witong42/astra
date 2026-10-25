import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const output = join(root, "dist/website");
const PUBLIC_ASSETS = [
  "icon.png",
  "banner.png",
  "banner-fr.png",
  "project.png",
  "project-focus.png",
  "travel.png",
  "quiz.png",
  "film-poster.png",
  "astra-demo-en.mp4",
  "astra-demo-en.vtt",
];
rmSync(output, { recursive: true, force: true });
mkdirSync(join(output, "assets"), { recursive: true });
const result = await Bun.build({
  entrypoints: [join(root, "website/site.ts")],
  outdir: output,
  target: "browser",
  naming: "site.js",
  minify: true,
});
if (!result.success)
  throw new AggregateError(result.logs, "Astra website build failed");
for (const file of ["index.html", "site.css"])
  copyFileSync(join(root, "website", file), join(output, file));
copyFileSync(join(root, "install.sh"), join(output, "install.sh"));
for (const file of PUBLIC_ASSETS)
  copyFileSync(
    join(root, ".github/assets", file),
    join(output, "assets", file),
  );
console.log(`Built Astra's public website in ${output}.`);
