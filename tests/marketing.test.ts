import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInNewContext } from "node:vm";
import { copy, siteLanguage } from "../website/copy";

test("the public site's language choice accepts French and falls back to English", () => {
  expect(siteLanguage("fr")).toBe("fr");
  for (const input of ["en", null, "de", "FR", "<script>"])
    expect(siteLanguage(input)).toBe("en");
});

test("French covers every public-site message, including accessible control names", async () => {
  expect(Object.keys(copy.fr).sort()).toEqual(Object.keys(copy.en).sort());
  const html = await Bun.file(
    new URL("../website/index.html", import.meta.url),
  ).text();
  const messages = [...html.matchAll(/data-i18n="([^"]+)"/g)].map(
    (match) => match[1],
  );
  for (const key of messages) {
    expect(copy.en[key as keyof typeof copy.en]).toBeTruthy();
    expect(copy.fr[key as keyof typeof copy.fr]).toBeTruthy();
  }
  expect(copy.fr.copyLabel).toContain("Copier");
  expect(copy.fr.videoLabel).toContain("anglais");
});

test("public copy omits ornamental arrows in both languages and HTML fallbacks", async () => {
  const arrows = /[↗↘↙↖→←▶]/;
  for (const language of ["en", "fr"] as const)
    for (const text of Object.values(copy[language]))
      expect(text).not.toMatch(arrows);
  const html = await Bun.file(
    new URL("../website/index.html", import.meta.url),
  ).text();
  expect(html).not.toMatch(arrows);
});

test("both languages present macOS, Windows and Linux with distinct installation steps", async () => {
  for (const language of ["en", "fr"] as const) {
    expect(copy[language].platforms).toContain("macOS");
    expect(copy[language].platforms).toContain("Windows");
    expect(copy[language].platforms).toContain("Linux");
    expect(copy[language].installAction).not.toMatch(/Mac/);
    expect(copy[language].windowsDownload).toContain("Windows");
    expect(copy[language].windowsTerminal).toContain("PowerShell");
    expect(copy[language].linuxDownload).toContain(".deb");
    expect(copy[language].linuxDownload).toContain("ARM64");
    expect(copy[language].linuxX64Download).toContain("x64");
    expect(copy[language].terminalRequirements).toContain("Apple Silicon");
    expect(copy[language].installTerminal).toContain("Linux");
    expect(copy[language].terminalRequirements).toContain("Debian");
  }
  const html = await Bun.file(
    new URL("../website/index.html", import.meta.url),
  ).text();
  expect(html).toContain('id="windows-download"');
  expect(html).toContain('id="windows-install-command"');
  expect(html).toContain(
    "irm https://getastra.halcytron.chatgpt.site/install.ps1 | iex",
  );
  expect(html).toContain('id="linux-download"');
  expect(html).toContain('id="linux-x64-download"');
  const description = html.match(/property="og:description" content="([^"]+)"/);
  for (const platform of ["macOS", "Windows", "Linux"])
    expect(description?.[1]).toContain(platform);
  for (const file of ["README.md", "README.fr.md"]) {
    const readme = await Bun.file(
      new URL(`../${file}`, import.meta.url),
    ).text();
    expect(readme).toContain("### Windows");
    expect(readme).toMatch(/### macOS (?:and|et) Linux/);
    expect(readme).toContain("ARM64");
    expect(readme).toContain("Install.cmd");
    expect(readme).toContain(
      "irm https://getastra.halcytron.chatgpt.site/install.ps1 | iex",
    );
    expect(readme).not.toMatch(
      /Windows version is in development|version Windows est en développement|Linux builds are not available|versions Linux ne sont pas encore disponibles/,
    );
  }
});

test("the gallery uses English demonstration content with identified sample data", async () => {
  for (const name of ["project-before", "project", "travel", "quiz"]) {
    const demo = await Bun.file(
      new URL(`../website/media/demos/${name}.json`, import.meta.url),
    ).json();
    const visible = demo.html
      .replace(/<style[\s\S]*?<\/style>/g, "")
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<[^>]*>/g, " ");
    expect(visible).not.toMatch(
      /Un projet|Un départ|DÉMO|DONNÉES FICTIVES|prochaines étapes/,
    );
    expect(visible).toContain("SAMPLE DATA");
  }
});

test("every public media reference resolves to a curated repository asset", async () => {
  const html = await Bun.file(
    new URL("../website/index.html", import.meta.url),
  ).text();
  const assets = [
    ...html.matchAll(/(?:src|poster|href)="\.\/assets\/([^"]+)"/g),
  ].map((match) => match[1]);
  expect(assets).toContain("astra-demo-en.mp4");
  for (const asset of assets)
    expect(
      await Bun.file(
        new URL(`../.github/assets/${asset}`, import.meta.url),
      ).exists(),
    ).toBe(true);
});

test("the public build excludes uncurated assets and stale output", () => {
  const fixture = mkdtempSync(join(tmpdir(), "astra-site-build-"));
  try {
    for (const directory of [
      "scripts",
      "website",
      ".github/assets",
      "dist/website",
    ])
      mkdirSync(join(fixture, directory), { recursive: true });
    copyFileSync(
      new URL("../scripts/build-marketing.ts", import.meta.url),
      join(fixture, "scripts/build-marketing.ts"),
    );
    for (const file of readdirSync(
      new URL("../.github/assets", import.meta.url),
    ))
      writeFileSync(join(fixture, ".github/assets", file), "public fixture");
    writeFileSync(
      join(fixture, ".github/assets/private-journal.json"),
      "private fixture",
    );
    writeFileSync(
      join(fixture, "dist/website/old-private-preview.html"),
      "private fixture",
    );
    writeFileSync(
      join(fixture, "website/site.ts"),
      "export const ready = true;",
    );
    writeFileSync(
      join(fixture, "website/index.html"),
      readFileSync(new URL("../website/index.html", import.meta.url), "utf8"),
    );
    writeFileSync(
      join(fixture, "package.json"),
      JSON.stringify({ version: "99.1.2" }),
    );
    writeFileSync(join(fixture, "website/site.css"), "body{margin:0}");
    writeFileSync(join(fixture, "install.sh"), "#!/bin/bash\n");
    writeFileSync(join(fixture, "install.ps1"), "& { 'fixture' }\n");
    execFileSync(process.execPath, ["scripts/build-marketing.ts"], {
      cwd: fixture,
    });
    const output = join(fixture, "dist/website");
    expect(existsSync(join(output, "assets/astra-demo-en.mp4"))).toBe(true);
    expect(existsSync(join(output, "install.sh"))).toBe(true);
    expect(readFileSync(join(output, "install.ps1"), "utf8")).toBe(
      "& { 'fixture' }\n",
    );
    expect(existsSync(join(output, "assets/private-journal.json"))).toBe(false);
    expect(existsSync(join(output, "assets/desktop.png"))).toBe(false);
    expect(existsSync(join(output, "old-private-preview.html"))).toBe(false);
    const html = readFileSync(join(output, "index.html"), "utf8");
    expect(html).toContain(
      "https://github.com/witong42/Astra/releases/download/v99.1.2/Astra-99.1.2-windows-x64.zip",
    );
    expect(html).not.toContain("__ASTRA_WINDOWS_DOWNLOAD_URL__");
    expect(html).toContain(
      "https://github.com/witong42/Astra/releases/download/v99.1.2/Astra-99.1.2-linux-arm64.deb",
    );
    expect(html).not.toContain("__ASTRA_LINUX_DOWNLOAD_URL__");
    expect(html).toContain(
      "https://github.com/witong42/Astra/releases/download/v99.1.2/Astra-99.1.2-linux-x64.deb",
    );
    expect(html).not.toContain("__ASTRA_LINUX_X64_DOWNLOAD_URL__");
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});

test("demo shots keep a stable horizon and one smooth camera direction", async () => {
  const html = await Bun.file(
    new URL("../website/media/astra-demo.html", import.meta.url),
  ).text();
  const script = html.slice(
    html.indexOf("<script>") + "<script>".length,
    html.lastIndexOf("</script>"),
  );
  const image = { width: 1440, height: 868 };
  const FRAME_RATE = 30;
  const MAX_CROP_VELOCITY = 20;
  const MAX_CROP_ACCELERATION = 2;
  const SUBPIXEL_TOLERANCE = 0.000001;
  const APP_CONTENT_BOTTOM = 868;
  let crops: number[][] = [];
  const context = {
    save() {},
    restore() {},
    fillRect() {},
    fillText() {},
    setLineDash() {},
    beginPath() {},
    roundRect() {},
    clip() {},
    fill() {},
    moveTo() {},
    bezierCurveTo() {},
    lineTo() {},
    stroke() {},
    createLinearGradient: () => ({ addColorStop() {} }),
    measureText: (text: string) => ({ width: text.length * 20 }),
    drawImage: (source: unknown, ...coordinates: number[]) => {
      if (source === image) crops.push(coordinates);
    },
    rotate: (radians: number) => expect(radians).toBe(0),
    scale: (x: number, y: number) => expect([x, y]).toEqual([1, 1]),
    translate() {},
  };
  const canvas = { getContext: () => context };
  const { drawers, shots } = runInNewContext(
    `${script}\n;({drawers:SCENE_DRAWERS,shots:TIMELINE.shots})`,
    {
      document: { getElementById: () => canvas, createElement: () => canvas },
      window: {},
    },
  ) as {
    drawers: ((...args: unknown[]) => void)[];
    shots: { t0: number; t1: number }[];
  };
  expect(shots).toHaveLength(8);
  for (const [index, shot] of shots.entries()) {
    const count = Math.round((shot.t1 - shot.t0) * FRAME_RATE);
    const positions: number[][] = [];
    const destinations: number[][] = [];
    for (let frame = 0; frame < count; frame++) {
      crops = [];
      const elapsed = frame / FRAME_RATE;
      drawers[index](
        image,
        shot.t0 + elapsed,
        elapsed / (shot.t1 - shot.t0),
        elapsed,
      );
      expect(crops.length).toBeGreaterThan(0);
      expect(crops[0][1] + crops[0][3]).toBeLessThanOrEqual(APP_CONTENT_BOTTOM);
      if (index >= 2) expect(crops[0][1]).toBeGreaterThanOrEqual(70);
      const destination = crops[0].slice(4);
      expect(destination[0]).toBeGreaterThanOrEqual(44);
      expect(destination[1]).toBeGreaterThanOrEqual(44);
      expect(destination[0] + destination[2]).toBeLessThanOrEqual(1876);
      expect(destination[1] + destination[3]).toBeLessThanOrEqual(1036);
      destinations.push(destination);
      positions.push(crops[0].slice(0, 4));
    }
    for (let axis = 0; axis < 4; axis++) {
      const direction = Math.sign(
        positions[positions.length - 1][axis] - positions[0][axis],
      );
      for (let frame = 1; frame < count; frame++) {
        const velocity = positions[frame][axis] - positions[frame - 1][axis];
        expect(velocity * direction).toBeGreaterThanOrEqual(
          -SUBPIXEL_TOLERANCE,
        );
        expect(Math.abs(velocity)).toBeLessThan(MAX_CROP_VELOCITY);
        if (frame > 1) {
          const previous =
            positions[frame - 1][axis] - positions[frame - 2][axis];
          expect(Math.abs(velocity - previous)).toBeLessThan(
            MAX_CROP_ACCELERATION,
          );
        }
      }
    }
    expect(
      Math.max(
        ...destinations[0].map((value, axis) =>
          Math.abs(destinations[destinations.length - 1][axis] - value),
        ),
      ),
    ).toBeGreaterThan(12);
  }
});

test("the creation demo reveals the app early and ends on the actual dashboard", async () => {
  const html = await Bun.file(
    new URL("../website/media/astra-demo.html", import.meta.url),
  ).text();
  const script = html.slice(
    html.indexOf("<script>") + "<script>".length,
    html.lastIndexOf("</script>"),
  );
  const canvas = { getContext: () => ({}) };
  const { footageFrame } = runInNewContext(`${script};({footageFrame})`, {
    document: { getElementById: () => canvas, createElement: () => canvas },
    window: {},
  }) as { footageFrame: (time: number) => number };
  const firstDashboardFrame = 281;
  const lastDashboardFrame = 787;
  expect(footageFrame(7.5)).toBe(firstDashboardFrame);
  expect(footageFrame(29.9)).toBe(lastDashboardFrame);
  let previous = 0;
  for (let frame = 0; frame < 900; frame++) {
    const source = footageFrame(frame / 30);
    expect(source).toBeGreaterThanOrEqual(previous);
    expect(source).toBeLessThanOrEqual(lastDashboardFrame);
    previous = source;
  }
});

test.skipIf(!Bun.which("ffprobe"))(
  "the public demo is a thirty-second movie with audio and matching captions",
  async () => {
    const asset = new URL(
      "../.github/assets/astra-demo-en.mp4",
      import.meta.url,
    );
    const metadata = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration:stream=codec_type,codec_name,width,height,nb_frames",
          "-of",
          "json",
          asset.pathname,
        ],
        { encoding: "utf8" },
      ),
    );
    const video = metadata.streams.find(
      (stream: { codec_type: string }) => stream.codec_type === "video",
    );
    expect(video).toMatchObject({
      codec_name: "h264",
      width: 1920,
      height: 1080,
      nb_frames: "900",
    });
    expect(
      metadata.streams.some(
        (stream: { codec_type: string }) => stream.codec_type === "audio",
      ),
    ).toBe(true);
    const duration = Number(metadata.format.duration);
    expect(duration).toBeGreaterThanOrEqual(30);
    expect(duration).toBeLessThan(30.1);
    const captions = await Bun.file(
      new URL("../.github/assets/astra-demo-en.vtt", import.meta.url),
    ).text();
    expect(captions).toContain(
      "You: Create a dashboard for my day, with priorities and a focus timer.",
    );
    expect(captions).toContain(
      "Astra: Your dashboard is ready with editable priorities and a focus/break timer.",
    );
    const seconds = (time: string) =>
      time.split(":").reduce((total, part) => total * 60 + Number(part), 0);
    const cues = [...captions.matchAll(/([\d:.]+) --> ([\d:.]+)/g)];
    expect(cues.length).toBeGreaterThan(0);
    let previousEnd = 0;
    for (const [, start, end] of cues) {
      expect(seconds(start)).toBeGreaterThanOrEqual(previousEnd);
      expect(seconds(end)).toBeGreaterThan(seconds(start));
      expect(seconds(end)).toBeLessThanOrEqual(duration);
      previousEnd = seconds(end);
    }
  },
);
