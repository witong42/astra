import assert from "node:assert/strict";
import { join } from "node:path";
import { beginCanvasGeneration } from "../src/canvas";
import { applyOpenUI } from "../src/openui";
import { loadState, newWorkspace, saveState } from "../src/storage";
import type { Snapshot } from "../src/types";
import { desktopClient, showWorkspace } from "./desktop-client";

const PROFILE = "/tmp/astra-openui-check";
const THREE_MODULE =
  "https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.js";
const SEED_NAME = "Orbit Lab";
const ROOT = join(import.meta.dir, "..");
const SOURCE = `root = Stack([title, intro, scene, controls, notes])
$speed = 1
$paused = false
$notes = ""
title = Heading("A small world in motion.")
intro = Text("Move the speed control or pause the orbit. The scene responds locally, without another model call.")
scene = LiveCanvas({speed: $speed, paused: $paused}, 360)
controls = Grid([Slider("speed", "Orbit speed", 0, 3, 0.1, $speed), Toggle("paused", "Pause motion", $paused)], 2)
notes = Input("notes", "Observations", $notes, true)`;
const HTML = `<main id="substrate"><div id="scene"></div><script type="module">
import * as THREE from '${THREE_MODULE}';
const host=document.getElementById('scene');
const scene=new THREE.Scene();scene.background=new THREE.Color('#111b20');
const camera=new THREE.PerspectiveCamera(45,1,0.1,100);camera.position.set(0,5,9);camera.lookAt(0,0,0);
const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));host.replaceChildren(renderer.domElement);
scene.add(new THREE.AmbientLight(0xffffff,1.8));const light=new THREE.PointLight(0xffd6a0,30);scene.add(light);
const sun=new THREE.Mesh(new THREE.SphereGeometry(.6,24,16),new THREE.MeshBasicMaterial({color:0xf4bc70}));scene.add(sun);
const planet=new THREE.Mesh(new THREE.SphereGeometry(.27,20,12),new THREE.MeshStandardMaterial({color:0x9ec7af,roughness:.6}));scene.add(planet);
const ring=new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({length:128},(_,i)=>new THREE.Vector3(Math.cos(i*Math.PI/64)*2.4,0,Math.sin(i*Math.PI/64)*2.4))),new THREE.LineBasicMaterial({color:0x40545a}));scene.add(ring);
const probe=window.orbitProbe={frames:0,angle:0,speed:1,paused:false};
function inputs(){const v=window.canvasInputs??{};probe.speed=Number(v.speed??1);probe.paused=v.paused===true;host.dataset.speed=String(probe.speed);host.dataset.paused=String(probe.paused);}
inputs();addEventListener('astra:inputs',inputs);
new ResizeObserver(()=>{const w=host.clientWidth,h=host.clientHeight;if(!w||!h)return;renderer.setSize(w,h);camera.aspect=w/h;camera.updateProjectionMatrix();}).observe(host);
let previous=performance.now();function tick(now){const dt=Math.min((now-previous)/1000,.1);previous=now;if(!probe.paused)probe.angle+=dt*probe.speed;planet.position.set(Math.cos(probe.angle)*2.4,0,Math.sin(probe.angle)*2.4);renderer.render(scene,camera);probe.frames++;requestAnimationFrame(tick);}requestAnimationFrame(tick);
</script></main>`;
const CSS =
  "html,body,#substrate,#scene{margin:0;width:100%;height:100%;overflow:hidden}canvas{display:block}";

if (process.argv.includes("--prepare")) {
  const state = loadState(
    join(
      process.env.HOME ?? "",
      "Library/Application Support/Astra/workspace.json",
    ),
    ROOT,
  );
  const seed = newWorkspace(ROOT);
  seed.name = SEED_NAME;
  assert.ok(seed.canvas);
  seed.canvas.html = HTML;
  seed.canvas.css = CSS;
  beginCanvasGeneration(seed.canvas);
  applyOpenUI(seed.canvas, SOURCE, true);
  state.workspaces = [seed, newWorkspace(ROOT)];
  state.activeId = seed.id;
  saveState(join(PROFILE, "workspace.json"), state);
  console.log(
    "HYBRID_PROFILE_PREPARED",
    JSON.stringify({
      profile: PROFILE,
      workspaceId: seed.id,
      model: state.model,
      effort: state.reasoningEffort,
      tier: state.serviceTier,
    }),
  );
  process.exit(0);
}

const client = await desktopClient();
await showWorkspace(client, true);
let frame: Awaited<ReturnType<typeof desktopClient>> | undefined;
const snapshot = () => client.evaluate<Snapshot>("window.astra.snapshot()");
const evaluateCanvas = <T = unknown>(expression: string) => {
  assert.ok(frame, "Connect to the workspace canvas before inspecting it");
  return frame.evaluate<T>(expression);
};
const wait = async <T>(
  read: () => Promise<T>,
  check: (value: T) => boolean,
  message: string,
  timeout = 20000,
) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (check(value)) return value;
    await Bun.sleep(100);
  }
  throw new Error(message);
};
const click = async (selector: string) => {
  const position = await client.evaluate<{ x: number; y: number }>(
    `(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`,
  );
  await client.call("Input.dispatchMouseEvent", {
    type: "mousePressed",
    button: "left",
    clickCount: 1,
    ...position,
  });
  await client.call("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    button: "left",
    clickCount: 1,
    ...position,
  });
};
const settings = (state: Snapshot) => [
  state.model,
  state.reasoningEffort,
  state.serviceTier,
];
const waitForCanvas = async (id: string) => {
  const result = await wait(
    async () => {
      try {
        return await desktopClient("canvas", id);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("No live canvas exists")
        )
          return null;
        throw error;
      }
    },
    Boolean,
    "The workspace iframe must become available",
  );
  assert.ok(result);
  return result;
};
try {
  const initial = await wait(
    snapshot,
    (state) => state.status === "ready",
    "Codex must connect",
  );
  const seed = initial.workspaces.find(
    (workspace) => workspace.name === SEED_NAME,
  );
  assert.ok(seed);
  assert.equal(seed.id, initial.activeId);
  frame = await waitForCanvas(seed.id);
  await wait(
    () =>
      frame
        ? frame.evaluate<number>("window.orbitProbe?.frames??0")
        : Promise.resolve(0),
    (count) => count > 2,
    "A real Three.js scene must render",
  );
  assert.equal(
    await frame.evaluate(
      "!!document.querySelector('canvas')?.getContext('webgl2')",
    ),
    true,
  );
  const timeOrigin = await frame.evaluate("performance.timeOrigin");
  const messagesBefore = seed.messages.length;
  await client.evaluate("document.querySelector('input[name=speed]').focus()");
  for (const type of ["keyDown", "keyUp"])
    await client.call("Input.dispatchKeyEvent", {
      type,
      key: "ArrowRight",
      code: "ArrowRight",
      windowsVirtualKeyCode: 39,
    });
  await wait(
    () => evaluateCanvas("window.orbitProbe.speed"),
    (value) => value === 1.1,
    "Slider must drive the live scene",
  );
  await click("input[name=paused]");
  await wait(
    () => evaluateCanvas("window.orbitProbe.paused"),
    (value) => value === true,
    "Toggle must pause the live scene",
  );
  const angle = await frame.evaluate("window.orbitProbe.angle");
  await Bun.sleep(150);
  assert.equal(await frame.evaluate("window.orbitProbe.angle"), angle);
  await client.evaluate(
    "document.querySelector('textarea[name=notes]').focus()",
  );
  await client.call("Input.insertText", { text: "Keep this observation." });
  await Bun.sleep(100);
  await client.evaluate("window.astraFlush()");
  let state = await snapshot();
  assert.equal(
    state.workspaces.find((workspace) => workspace.id === seed.id)?.canvas
      ?.openui?.state.$speed,
    1.1,
  );
  assert.equal(
    state.workspaces.find((workspace) => workspace.id === seed.id)?.canvas
      ?.openui?.state.$paused,
    true,
  );
  assert.equal(
    state.workspaces.find((workspace) => workspace.id === seed.id)?.messages
      .length,
    messagesBefore,
  );
  assert.equal(await frame.evaluate("performance.timeOrigin"), timeOrigin);
  assert.equal(await frame.evaluate("typeof window.astra"), "undefined");
  assert.equal(
    await frame.evaluate(
      "(()=>{try{return !!parent.document}catch{return false}})()",
    ),
    false,
  );
  const other = state.workspaces.find((workspace) => workspace.id !== seed.id);
  assert.ok(other);
  await client.evaluate(
    `window.astraFlush().then(()=>window.astra.selectWorkspace(${JSON.stringify(other.id)}))`,
  );
  frame.close();
  frame = undefined;
  await Bun.sleep(100);
  await client.evaluate(
    `window.astra.selectWorkspace(${JSON.stringify(seed.id)})`,
  );
  await Bun.sleep(200);
  frame = await waitForCanvas(seed.id);
  await wait(
    () => evaluateCanvas("window.orbitProbe?.speed"),
    (value) => value === 1.1,
    "Scene inputs must restore",
  );
  assert.equal(await frame.evaluate("window.orbitProbe.paused"), true);
  assert.equal(
    await client.evaluate(
      "document.querySelector('textarea[name=notes]').value",
    ),
    "Keep this observation.",
  );
  await client.screenshot("test-results/openui-hybrid-wide.png");
  await client.call("Emulation.setDeviceMetricsOverride", {
    width: 960,
    height: 920,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await Bun.sleep(100);
  assert.equal(
    await client.evaluate("document.documentElement.scrollWidth <= innerWidth"),
    true,
  );
  assert.equal(
    await client.evaluate(
      "document.querySelector('.openui-surface').scrollWidth <= document.querySelector('.openui-surface').clientWidth",
    ),
    true,
  );
  await client.screenshot("test-results/openui-hybrid-narrow.png");
  await client.call("Emulation.clearDeviceMetricsOverride");
  await client.evaluate("window.astraFlush()");
  await client.call("Page.reload");
  frame.close();
  frame = undefined;
  await Bun.sleep(300);
  await wait(
    () =>
      client.evaluate("document.querySelector('textarea[name=notes]')?.value"),
    (value) => value === "Keep this observation.",
    "Controls must survive renderer reload",
  );
  const disk = loadState(join(PROFILE, "workspace.json"), ROOT);
  assert.equal(
    disk.workspaces.find((workspace) => workspace.id === seed.id)?.canvas
      ?.openui?.state.$speed,
    1.1,
  );
  assert.equal(client.errors.length, 0);
  state = await snapshot();
  assert.deepEqual(settings(state), settings(initial));
  const result = {
    openuiControlsDriveThree: true,
    pauseWorks: true,
    noModelCall: true,
    noSceneReloadOnControlChange: true,
    controlsAndCanvasRestore: true,
    sandboxIntact: true,
    responsive: true,
    settingsUnchanged: true,
    errors: client.errors.length,
  };
  await Bun.write(
    "test-results/openui-verification.json",
    JSON.stringify(result, null, 2),
  );
  console.log("HYBRID_VERIFIED", JSON.stringify(result));
  if (process.argv.includes("--generate")) {
    await client.evaluate(
      "window.astraFlush().then(()=>window.astra.newWorkspace())",
    );
    await Bun.sleep(200);
    const prompt = `Create a hybrid orbit dashboard: an OpenUI heading, an OpenUI Slider named speed bound to $speed starting at 1 with range 0 to 3 and step 0.1, an OpenUI Toggle named paused bound to $paused starting false, an OpenUI Input named notes bound to $notes, and one LiveCanvas with inputs {speed: $speed, paused: $paused}. Inside LiveCanvas make a compact Three.js scene: one sun and one orbiting planet, procedural geometry only, using ${THREE_MODULE}. Controls must drive the running scene locally and retain values when reopening. Use window.canvasInputs and astra:inputs. Do not fetch or inspect files, use tools, rebuild or restart. Keep scene JS about 2000 characters. Generate OpenUI plus small Substrate operations.`;
    await client.evaluate(`window.astra.send(${JSON.stringify(prompt)})`);
    const completed = await wait(
      snapshot,
      (state) => state.status === "ready" && Boolean(state.metrics?.total),
      "Real hybrid generation must finish",
      120000,
    );
    assert.equal(completed.error, null);
    assert.equal(completed.approval, null);
    const generated = completed.workspaces.find(
      (workspace) => workspace.id === completed.activeId,
    );
    assert.ok(generated?.canvas?.openui);
    assert.ok(generated.canvas.html.includes("three"));
    await client.evaluate("window.astraFlush()");
    frame = await waitForCanvas(generated.id);
    await wait(
      () =>
        evaluateCanvas(
          "!!document.querySelector('canvas')?.getContext('webgl2')",
        ),
      Boolean,
      "The model-generated scene must render",
      20000,
    );
    assert.equal(client.errors.length, 0);
    assert.equal(frame.errors.length, 0);
    assert.deepEqual(settings(completed), settings(initial));
    await client.screenshot("test-results/openui-model-generated.png");
    await Bun.write(
      "test-results/openui-model-verification.json",
      JSON.stringify(
        {
          model: completed.model,
          effort: completed.reasoningEffort,
          tier: completed.serviceTier,
          metrics: completed.metrics,
          openui: true,
          webgl: true,
          errors: 0,
        },
        null,
        2,
      ),
    );
    console.log(
      "MODEL_HYBRID_VERIFIED",
      JSON.stringify({
        metrics: completed.metrics,
        model: completed.model,
        settingsUnchanged: true,
      }),
    );
    const generatedOrigin = await frame.evaluate("performance.timeOrigin");
    await client.evaluate(
      "document.querySelector('input[name=speed]').focus()",
    );
    for (const type of ["keyDown", "keyUp"])
      await client.call("Input.dispatchKeyEvent", {
        type,
        key: "ArrowRight",
        code: "ArrowRight",
        windowsVirtualKeyCode: 39,
      });
    await wait(
      () => evaluateCanvas("window.canvasInputs.speed"),
      (value) => value === 1.1,
      "Generated controls must reach the scene",
    );
    assert.equal(
      await frame.evaluate("performance.timeOrigin"),
      generatedOrigin,
    );
    await client.evaluate("window.astraFlush()");
    const edit =
      'Keep this hybrid layout, its existing $variable and component statement names, scene code and saved field values. Only change the heading to "Orbit, your way" and add a Metric labelled "Current speed" that reads $speed. Emit the complete updated OpenUI program only; no Substrate operations, tools, files or rebuilds.';
    await client.evaluate(`window.astra.send(${JSON.stringify(edit)})`);
    const edited = await wait(
      snapshot,
      (state) => state.status === "ready" && Boolean(state.metrics?.total),
      "Hybrid edit must finish",
      90000,
    );
    assert.equal(edited.error, null);
    const editedCanvas = edited.workspaces.find(
      (workspace) => workspace.id === generated.id,
    )?.canvas;
    assert.ok(editedCanvas?.openui);
    assert.ok(editedCanvas.openui.source.includes("Orbit, your way"));
    assert.equal(editedCanvas.openui.state.$speed, 1.1);
    await wait(
      () =>
        client.evaluate("document.querySelector('input[name=speed]')?.value"),
      (value) => value === "1.1",
      "Edited controls must keep their value",
    );
    await client.evaluate(
      "document.querySelector('input[name=speed]').focus()",
    );
    for (const type of ["keyDown", "keyUp"])
      await client.call("Input.dispatchKeyEvent", {
        type,
        key: "ArrowRight",
        code: "ArrowRight",
        windowsVirtualKeyCode: 39,
      });
    await Bun.sleep(100);
    await client.evaluate("window.astraFlush()");
    const historyIndex = editedCanvas.history.length - 1;
    await client.evaluate(`window.astra.restoreCanvas(${historyIndex})`);
    await wait(
      () =>
        client.evaluate("document.querySelector('input[name=speed]')?.value"),
      (value) => value === "1.1",
      "Version restore must restore the control state",
    );
    await client.evaluate(
      "document.querySelector('input[name=speed]').focus()",
    );
    for (const type of ["keyDown", "keyUp"])
      await client.call("Input.dispatchKeyEvent", {
        type,
        key: "ArrowRight",
        code: "ArrowRight",
        windowsVirtualKeyCode: 39,
      });
    await Bun.sleep(100);
    await client.evaluate("window.astraFlush()");
    const afterRestore = await snapshot();
    assert.equal(
      afterRestore.workspaces.find((workspace) => workspace.id === generated.id)
        ?.canvas?.openui?.state.$speed,
      1.2,
    );
    assert.equal(afterRestore.error, null);
    assert.equal(client.errors.length, 0);
    console.log(
      "MODEL_HYBRID_EDIT_AND_RESTORE_VERIFIED",
      JSON.stringify({
        localInputs: true,
        editedStatePreserved: true,
        versionRestore: true,
        editsAfterRestoreSaved: true,
      }),
    );
  }
} finally {
  frame?.close();
  client.close();
}
