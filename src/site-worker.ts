export type SiteAsset = {
  body: string;
  contentType: string;
  encoding?: "base64";
};
export type SiteAssets = Record<string, SiteAsset>;
declare const __ASTRA_SITE_ASSETS__: SiteAssets;
const HTML_CONTENT_TYPE = "text/html";
const ASSET_CACHE_CONTROL = "public, max-age=0, must-revalidate";
const HTML_CACHE_CONTROL = `${ASSET_CACHE_CONTROL}, no-transform`;
const ALIASES: Record<string, string> = {
  "/": "/index.html",
  "/index": "/index.html",
  "/canvas": "/canvas.html",
};

export function siteResponse(request: Request, assets: SiteAssets) {
  if (request.method !== "GET" && request.method !== "HEAD")
    return new Response("Use GET or HEAD for an Astra asset.", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  const path = new URL(request.url).pathname;
  const name = Object.hasOwn(ALIASES, path) ? ALIASES[path] : path;
  if (!Object.hasOwn(assets, name))
    return new Response("Astra asset not found.", { status: 404 });
  const asset = assets[name];
  const body =
    request.method === "HEAD"
      ? null
      : asset.encoding === "base64"
        ? Uint8Array.from(atob(asset.body), (character) =>
            character.charCodeAt(0),
          )
        : asset.body;
  return new Response(body, {
    headers: {
      "Content-Type": asset.contentType,
      "Cache-Control": asset.contentType.startsWith(HTML_CONTENT_TYPE)
        ? HTML_CACHE_CONTROL
        : ASSET_CACHE_CONTROL,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export default {
  fetch: (request: Request) => siteResponse(request, __ASTRA_SITE_ASSETS__),
};
