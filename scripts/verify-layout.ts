import assert from "node:assert/strict";
import { desktopClient } from "./desktop-client";

const client = await desktopClient();
try {
  await client.evaluate(`{
    const history = document.querySelector('.messages');
    const probe = document.createElement('div');
    probe.id = 'layout-regression-probe';
    probe.style.height = '10000px';
    history.append(probe);
    probe.scrollIntoView({block:'end'});
  }`);
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
      sidebarWidth: number;
      workspaceRowHeight: number;
    }>(`(() => {
      const chat = document.querySelector('.conversation-main').getBoundingClientRect();
      const canvas = document.querySelector('.canvas').getBoundingClientRect();
      const input = document.querySelector('.composer').getBoundingClientRect();
      return {composerBottom:input.bottom, toolbarTop:document.querySelector('.toolbar').getBoundingClientRect().top,
        documentHeight:document.documentElement.scrollHeight, height:innerHeight,
        canvasWidth:canvas.width,chatWidth:chat.width,
        sidebarWidth:document.querySelector('.sidebar').getBoundingClientRect().width,
        workspaceRowHeight:document.querySelector('.workspace-link').getBoundingClientRect().height,
        centerError:Math.abs(chat.x+chat.width/2-input.x-input.width/2)};
    })()`);
    assert.ok(
      layout.composerBottom < layout.height,
      "Long chat must keep the input visible",
    );
    assert.equal(
      layout.toolbarTop,
      0,
      "Conversation scrolling must keep the toolbar in place",
    );
    assert.ok(
      layout.documentHeight <= layout.height,
      "Only conversation history should scroll",
    );
    assert.ok(
      layout.canvasWidth > layout.chatWidth,
      "The canvas must be larger than chat",
    );
    assert.ok(layout.centerError < 2, "The input must be centered within chat");
    assert.ok(
      layout.sidebarWidth >= 208,
      "Workspace navigation must remain readable at the minimum window width",
    );
    assert.ok(
      layout.workspaceRowHeight >= 40,
      "Workspace rows need breathing room",
    );
    console.log("LAYOUT_VERIFIED", width, height, JSON.stringify(layout));
  }
  const canvasFrame = await client.evaluate(`(() => {
    const frame = document.querySelector('.canvas-frame');
    window.__layoutFrame = frame;
    document.querySelector('.canvas-toggle').click();
    return Boolean(frame);
  })()`);
  await Bun.sleep(50);
  assert.equal(
    await client.evaluate(
      "getComputedStyle(document.querySelector('.canvas')).display",
    ),
    "none",
  );
  await client.evaluate("document.querySelector('.canvas-toggle').click()");
  await Bun.sleep(50);
  assert.equal(
    await client.evaluate(
      "document.querySelector('.canvas-frame') === window.__layoutFrame",
    ),
    true,
    "Toggling canvas must preserve its iframe and running UI",
  );
  assert.equal(canvasFrame, true);
  await client.evaluate("delete window.__layoutFrame");
  assert.equal(client.errors.length, 0);
} finally {
  await client.evaluate(
    "document.getElementById('layout-regression-probe')?.remove()",
  );
  await client.call("Emulation.clearDeviceMetricsOverride");
  client.close();
}
