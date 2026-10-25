import assert from "node:assert/strict";
import type { Snapshot } from "../src/types";
import { desktopClient, showWorkspace } from "./desktop-client";

const THREE_MODULE =
  "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js";
const client = await desktopClient();
await showWorkspace(client, true);
let frame: Awaited<ReturnType<typeof desktopClient>> | undefined;
const snapshot = () => client.evaluate<Snapshot>("window.astra.snapshot()");
try {
  const initial = await snapshot();
  assert.equal(initial.status, "ready");
  await client.evaluate(
    "window.astraFlush().then(()=>window.astra.newWorkspace())",
  );
  await Bun.sleep(200);
  const origin = await client.evaluate("performance.timeOrigin");
  const prompt = `Create a small interactive 3D orbit lab in the canvas using Three.js. A sun and three colored planets orbit in a dark scene, with a readable HTML title and a working HTML range slider labelled Speed, from 0 to 3, starting at 1. Import Three.js from ${THREE_MODULE} in an inline module. Use procedural sphere geometry only, no addons, textures, assets or fonts. Keep the JavaScript compact, about 2500 characters. Use one animation loop, cap pixel ratio at 1.5, adapt to the canvas container with ResizeObserver. Save speed in DOM state and read it back on reopening. The renderer should live in a container with id scene. Do not fetch files, use tools, inspect this project or rebuild anything. Output small streamed Substrate operations.`;
  await client.evaluate('document.querySelector(".composer textarea").focus()');
  await client.call("Input.insertText", { text: prompt });
  await client.call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  await client.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  let completed: Snapshot | undefined;
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    const state = await snapshot();
    assert.equal(state.error, null);
    assert.equal(state.approval, null);
    if (state.status === "ready" && state.metrics?.total) {
      completed = state;
      break;
    }
    await Bun.sleep(200);
  }
  assert.ok(completed, "Three.js generation must finish");
  frame = await desktopClient("canvas");
  let rendered = false;
  for (let i = 0; i < 100; i++) {
    const info = await frame.evaluate<{
      width: number;
      height: number;
      webgl: boolean;
    }>(
      `(() => {const canvas=document.querySelector('#scene canvas');return {width:canvas?.width??0,height:canvas?.height??0,webgl:!!canvas?.getContext('webgl2')};})()`,
    );
    if (info.width > 0 && info.height > 0 && info.webgl) {
      rendered = true;
      console.log("WEBGL", JSON.stringify(info));
      break;
    }
    await Bun.sleep(200);
  }
  assert.ok(rendered, "An actual WebGL scene must render");
  const before = await snapshot();
  await frame.evaluate(
    `{const slider=document.querySelector('input[type=range]');slider.value='2';slider.dispatchEvent(new Event('input',{bubbles:true}));slider.dispatchEvent(new Event('change',{bubbles:true}));}`,
  );
  await client.evaluate("window.astraFlush()");
  const after = await snapshot();
  assert.equal(
    before.workspaces.find((w) => w.id === before.activeId)?.messages.length,
    after.workspaces.find((w) => w.id === after.activeId)?.messages.length,
  );
  assert.equal(await client.evaluate("performance.timeOrigin"), origin);
  assert.equal(client.errors.length, 0);
  assert.equal(frame.errors.length, 0);
  await client.screenshot("test-results/three-live.png");
  const result = {
    module: THREE_MODULE,
    metrics: completed.metrics,
    webgl: true,
    localSlider: true,
    samePage: true,
    rendererErrors: 0,
  };
  await Bun.write(
    "test-results/three-verification.json",
    JSON.stringify(result, null, 2),
  );
  console.log("THREE_VERIFIED", JSON.stringify(result));
} finally {
  frame?.close();
  client.close();
}
