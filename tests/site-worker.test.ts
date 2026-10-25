import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { type SiteAssets, siteResponse } from "../src/site-worker";

const WEB_BUILD_TIMEOUT_MS = 30_000;

test(
  "the phone build serves its package version and build from a fresh worker process",
  () => {
    const root = join(import.meta.dir, "..");
    const directory = mkdtempSync(join(tmpdir(), "astra-web-version-"));
    try {
      for (const path of ["src", "scripts", "assets"])
        cpSync(join(root, path), join(directory, path), { recursive: true });
      symlinkSync(
        join(root, "node_modules"),
        join(directory, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );
      writeFileSync(
        join(directory, "package.json"),
        JSON.stringify({ version: "99.1.2", astraBuild: 42 }),
      );
      execFileSync(process.execPath, ["scripts/build-web.ts"], {
        cwd: directory,
        timeout: WEB_BUILD_TIMEOUT_MS,
        env: {
          ...process.env,
          ASTRA_REMOTE_URL: "https://astra-backend.example.com",
        },
      });
      const result = JSON.parse(
        execFileSync(
          process.execPath,
          [
            "-e",
            `
      const worker = (await import(${JSON.stringify(pathToFileURL(join(directory, "dist/server/index.js")).href)})).default;
      const response = worker.fetch(new Request("https://astra.example/"));
      console.log(JSON.stringify({html:await response.text(),cacheControl:response.headers.get("cache-control")}));
    `,
          ],
          { cwd: directory, encoding: "utf8", timeout: WEB_BUILD_TIMEOUT_MS },
        ),
      );
      expect(result.html).toContain(
        'name="application-version" content="99.1.2"',
      );
      expect(result.html).toContain('name="astra-build" content="42"');
      expect(result.cacheControl).toContain("no-transform");
      expect(
        readFileSync(join(directory, "dist/client/web.js"), "utf8"),
      ).toContain("99.1.2");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  WEB_BUILD_TIMEOUT_MS * 2,
);

const assets: SiteAssets = {
  "/index.html": {
    body: "<main>Astra</main>",
    contentType: "text/html; charset=utf-8",
  },
  "/canvas.html": {
    body: '<main id="substrate"></main>',
    contentType: "text/html; charset=utf-8",
  },
  "/web.js": {
    body: "console.log('Astra')",
    contentType: "text/javascript; charset=utf-8",
  },
  "/icon.png": {
    body: "AAEC//4=",
    contentType: "image/png",
    encoding: "base64",
  },
};

test("HTML response headers prevent injected scripts while preserving canvas and launcher aliases", async () => {
  for (const path of [
    "/",
    "/index",
    "/index.html",
    "/canvas",
    "/canvas.html",
  ]) {
    const response = siteResponse(
      new Request(`https://astra.example${path}`),
      assets,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-transform");
    expect(await response.text()).toContain("<main");
  }
});

test("asset delivery preserves exact binary and script bytes and rejects unknown paths and writes", async () => {
  const image = siteResponse(
    new Request("https://astra.example/icon.png"),
    assets,
  );
  expect([...new Uint8Array(await image.arrayBuffer())]).toEqual([
    0, 1, 2, 255, 254,
  ]);
  const script = siteResponse(
    new Request("https://astra.example/web.js"),
    assets,
  );
  expect(await script.text()).toBe(assets["/web.js"].body);
  expect(script.headers.get("content-type")).toContain("text/javascript");
  const head = siteResponse(
    new Request("https://astra.example/canvas", { method: "HEAD" }),
    assets,
  );
  expect(head.headers.get("cache-control")).toContain("no-transform");
  expect(await head.text()).toBe("");
  for (const path of ["/__proto__", "/constructor", "/unknown"])
    expect(
      siteResponse(new Request(`https://astra.example${path}`), assets).status,
    ).toBe(404);
  expect(
    siteResponse(
      new Request("https://astra.example/", { method: "POST" }),
      assets,
    ).status,
  ).toBe(405);
});
