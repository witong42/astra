import assert from "node:assert/strict";
import { desktopClient } from "./desktop-client";

const app = await desktopClient();
const canvas = await desktopClient("canvas");
try {
  await app.evaluate(`{
    window.__canvasLinks = [];
    window.__captureLink = (event) => {
      if (event.source === document.querySelector('.canvas-frame').contentWindow && event.data?.type === 'canvas:open-link') {
        event.stopImmediatePropagation();
        window.__canvasLinks.push(event.data.url);
      }
    };
    addEventListener('message', window.__captureLink, true);
  }`);
  const link = await canvas.evaluate<{ x: number; y: number }>(`(() => {
    const link = document.createElement('a');
    link.id = 'canvas-link-regression';
    link.href = 'https://example.com/codexos-check';
    link.textContent = 'Check external link';
    link.style.cssText = 'position:fixed;top:16px;left:16px;padding:12px;background:white;color:black;z-index:2147483647';
    document.getElementById('substrate').append(link);
    link.click();
    const rect = link.getBoundingClientRect();
    return {x:rect.x+rect.width/2,y:rect.y+rect.height/2};
  })()`);
  await Bun.sleep(50);
  assert.equal(
    await app.evaluate("window.__canvasLinks.length"),
    0,
    "Synthetic clicks must not open the browser",
  );
  const frame = await app.evaluate<{ x: number; y: number }>(
    "(() => {const r=document.querySelector('.canvas-frame').getBoundingClientRect();return {x:r.x,y:r.y}})()",
  );
  for (const type of ["mousePressed", "mouseReleased"]) {
    await app.call("Input.dispatchMouseEvent", {
      type,
      x: frame.x + link.x,
      y: frame.y + link.y,
      button: "left",
      clickCount: 1,
    });
  }
  await Bun.sleep(100);
  assert.deepEqual(await app.evaluate("window.__canvasLinks"), [
    "https://example.com/codexos-check",
  ]);
  assert.ok(
    await canvas.evaluate("location.href.endsWith('/dist/canvas.html')"),
    "Web links must keep the canvas runtime in place",
  );
  await app.evaluate("window.codexosFlush()");
  const rejection = await app.evaluate(
    "window.codexos.openExternal('file:///etc/passwd').then(()=>false,()=>true)",
  );
  assert.equal(
    rejection,
    true,
    "The main process must reject non-web protocols",
  );
  assert.equal(app.errors.length, 0);
  assert.equal(canvas.errors.length, 0);
  console.log(
    "CANVAS_LINKS_VERIFIED",
    JSON.stringify({
      trustedClick: true,
      syntheticClickBlocked: true,
      captureStillWorks: true,
      unsafeProtocolBlocked: true,
      errors: 0,
    }),
  );
} finally {
  await canvas.evaluate(
    "document.getElementById('canvas-link-regression')?.remove()",
  );
  await app.evaluate(
    "removeEventListener('message', window.__captureLink, true);delete window.__captureLink;delete window.__canvasLinks",
  );
  await app.evaluate("window.codexosFlush()");
  canvas.close();
  app.close();
}
