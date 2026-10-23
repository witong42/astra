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
  for (const width of [1440, 960]) {
    await client.call("Emulation.setDeviceMetricsOverride", {
      width,
      height: 920,
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
    }>(`(() => {
      const chat = document.querySelector('.conversation-main').getBoundingClientRect();
      const canvas = document.querySelector('.canvas').getBoundingClientRect();
      const input = document.querySelector('.composer').getBoundingClientRect();
      return {composerBottom:input.bottom, toolbarTop:document.querySelector('.toolbar').getBoundingClientRect().top,
        documentHeight:document.documentElement.scrollHeight, height:innerHeight,
        canvasWidth:canvas.width,chatWidth:chat.width,
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
    console.log("LAYOUT_VERIFIED", width, JSON.stringify(layout));
  }
} finally {
  await client.evaluate(
    "document.getElementById('layout-regression-probe')?.remove()",
  );
  await client.call("Emulation.clearDeviceMetricsOverride");
  client.close();
}
