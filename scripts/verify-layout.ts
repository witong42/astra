import assert from "node:assert/strict";
import { desktopClient, showWorkspace } from "./desktop-client";

const client = await desktopClient();
try {
  await showWorkspace(client, true);
  await client.evaluate(
    `{const probe=document.createElement('div');probe.id='layout-regression-probe';probe.style.height='10000px';document.querySelector('.messages').append(probe);probe.scrollIntoView({block:'end'});}`,
  );
  for (const [width, height] of [
    [1440, 920],
    [960, 920],
    [960, 650],
  ]) {
    await client.call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const layout = await client.evaluate<{
      composerBottom: number;
      toolbarTop: number;
      documentHeight: number;
      height: number;
      canvasWidth: number;
      chatWidth: number;
      centerError: number;
    }>(
      `(()=>{const chat=document.querySelector('.chat-drawer').getBoundingClientRect(),canvas=document.querySelector('.app-stage').getBoundingClientRect(),input=document.querySelector('.composer').getBoundingClientRect();return {composerBottom:input.bottom,toolbarTop:document.querySelector('.toolbar').getBoundingClientRect().top,documentHeight:document.documentElement.scrollHeight,height:innerHeight,canvasWidth:canvas.width,chatWidth:chat.width,centerError:Math.abs(chat.x+chat.width/2-input.x-input.width/2)}})()`,
    );
    assert.ok(
      layout.composerBottom < layout.height,
      "Long chat keeps the input visible",
    );
    assert.equal(layout.toolbarTop, 0);
    assert.ok(layout.documentHeight <= layout.height);
    assert.equal(
      layout.canvasWidth,
      width,
      "Canvas retains the whole content area behind chat",
    );
    assert.ok(layout.chatWidth <= 440);
    assert.ok(layout.centerError < 2, "Input stays centered in the drawer");
    console.log("LAYOUT_VERIFIED", width, height, JSON.stringify(layout));
  }
  await client.evaluate(
    "window.__layoutFrame=document.querySelector('.canvas-frame');document.querySelector('.close-chat').click()",
  );
  assert.equal(
    await client.evaluate("document.querySelector('.chat-drawer').inert"),
    true,
  );
  await client.evaluate("document.getElementById('chat-toggle').click()");
  assert.equal(
    await client.evaluate(
      "document.querySelector('.canvas-frame')===window.__layoutFrame",
    ),
    true,
    "Chat toggling keeps the app runtime alive",
  );
  assert.equal(client.errors.length, 0);
} finally {
  await client.evaluate(
    "document.getElementById('layout-regression-probe')?.remove();delete window.__layoutFrame",
  );
  await client.call("Emulation.clearDeviceMetricsOverride");
  client.close();
}
