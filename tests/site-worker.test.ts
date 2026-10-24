import { expect, test } from "bun:test";
import { type SiteAssets, siteResponse } from "../src/site-worker";

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
