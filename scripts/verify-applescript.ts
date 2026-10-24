import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beginCanvasGeneration } from "../src/canvas";
import { applyOpenUI } from "../src/openui";
import { loadState, saveState } from "../src/storage";
import { desktopClient, showWorkspace } from "./desktop-client";

const root = join(import.meta.dir, "..");
const profile = mkdtempSync(join(tmpdir(), "codexos-applescript-check-"));
const file = join(profile, "workspace.json");
const state = loadState(file, root);
const workspace = state.workspaces[0];
assert.ok(workspace.canvas);
beginCanvasGeneration(workspace.canvas);
workspace.canvas.html = `<main id="substrate"><input id="argument" value="unchanged &amp; quoted &quot; data"><button id="native" data-applescript="echo" data-applescript-inputs='["#argument"]' data-applescript-output="#result">Native action</button><output id="result"></output><script id="echo" type="text/applescript">on run argv
return item 1 of argv
end run</script></main>`;
applyOpenUI(
  workspace.canvas,
  'root = Stack([AppleScriptButton("OpenUI native action", "return 6 * 7"), LiveCanvas({}, 360)])',
  true,
);
saveState(file, state);
const electron = Bun.spawn(
  [
    join(root, "node_modules/.bin/electron"),
    root,
    "--remote-debugging-port=9337",
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      CODEXOS_DATA_DIR: profile,
      CODEXOS_TEST_HIDDEN: "1",
    },
    stdout: "ignore",
    stderr: "inherit",
  },
);
let app: Awaited<ReturnType<typeof desktopClient>> | undefined;
let canvas: Awaited<ReturnType<typeof desktopClient>> | undefined;
async function waitFor<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  label = "native action result",
) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (ready(value)) return value;
    await Bun.sleep(50);
  }
  throw new Error(`Native action verification timed out: ${label}.`);
}
try {
  await waitFor(
    async () => {
      try {
        app = await desktopClient();
        return true;
      } catch {
        return false;
      }
    },
    Boolean,
    "test window",
  );
  assert.ok(app);
  await showWorkspace(app);
  await waitFor(
    async () => {
      try {
        canvas = await desktopClient("canvas");
        return true;
      } catch {
        return false;
      }
    },
    Boolean,
    "canvas frame",
  );
  assert.ok(canvas);
  await waitFor(
    () =>
      canvas?.evaluate<boolean>('!!document.getElementById("native")') ??
      Promise.resolve(false),
    Boolean,
    "canvas content",
  );
  await canvas.evaluate('document.getElementById("native").click()');
  const forgedMarker = join(profile, "forged-action");
  const forgedScript = `do shell script "/usr/bin/touch " & quoted form of ${JSON.stringify(forgedMarker)}`;
  await canvas.evaluate(
    `parent.postMessage({type:"canvas:applescript",requestId:"forged",request:{script:${JSON.stringify(forgedScript)},args:[]}},"*")`,
  );
  await Bun.sleep(150);
  assert.equal(
    await Bun.file(forgedMarker).exists(),
    false,
    "Ordinary window messages must not execute native scripts",
  );
  assert.equal(
    await canvas.evaluate('document.getElementById("result").textContent'),
    "",
    "Synthetic clicks must not execute native scripts",
  );
  const position = await canvas.evaluate<{ x: number; y: number }>(
    '(()=>{const r=document.getElementById("native").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()',
  );
  const frame = await app.evaluate<{ x: number; y: number }>(
    '(()=>{const r=document.querySelector(".canvas-frame").getBoundingClientRect();return {x:r.x,y:r.y}})()',
  );
  const start = performance.now();
  for (const type of ["mousePressed", "mouseReleased"])
    await app.call("Input.dispatchMouseEvent", {
      type,
      x: frame.x + position.x,
      y: frame.y + position.y,
      button: "left",
      clickCount: 1,
    });
  const result = await waitFor(
    () =>
      canvas?.evaluate<string>(
        'document.getElementById("result").textContent',
      ) ?? Promise.resolve(""),
    Boolean,
  );
  const elapsedMs = Math.round(performance.now() - start);
  assert.equal(result, 'unchanged & quoted " data');
  await app.evaluate(
    'Array.from(document.querySelectorAll(".openui-button")).find(b=>b.textContent==="OpenUI native action").click()',
  );
  assert.equal(
    await waitFor(
      () =>
        app?.evaluate<string>(
          'document.querySelector(".openui-surface pre")?.textContent ?? ""',
        ) ?? Promise.resolve(""),
      Boolean,
    ),
    "42",
  );
  await app.evaluate("window.codexosFlush()");
  const observed = await app.evaluate<{ messages: number; busy: boolean }>(
    `window.codexos.snapshot().then(s=>({messages:s.workspaces.find(w=>w.id===s.activeId).messages.length,busy:s.sessions[s.activeId]?.busy??false}))`,
  );
  assert.equal(
    observed.messages,
    0,
    "Native actions must not create assistant messages",
  );
  assert.equal(observed.busy, false);
  assert.equal(await canvas.evaluate("typeof window.require"), "undefined");
  assert.equal(
    await app.evaluate(
      'window.codexos.runAppleScript("00000000-0000-4000-8000-000000000000",{script:"return 1",args:[]}).then(()=>false,()=>true)',
    ),
    true,
  );
  assert.equal(app.errors.length, 0);
  assert.equal(canvas.errors.length, 0);
  console.log(
    "APPLESCRIPT_VERIFIED",
    JSON.stringify({
      elapsedMs,
      canvasResult: result,
      openuiResult: 42,
      assistantMessages: 0,
      syntheticClickBlocked: true,
      forgedMessageBlocked: true,
      foreignWorkspaceBlocked: true,
      profile,
    }),
  );
} catch (error) {
  console.error(
    "NATIVE_CHECK_STATE",
    await app?.evaluate(
      '({body:document.body.innerText,frames:document.querySelectorAll("iframe").length})',
    ),
    await canvas?.evaluate(
      '({html:document.getElementById("substrate").outerHTML})',
    ),
  );
  throw error;
} finally {
  canvas?.close();
  app?.close();
  electron.kill();
  await electron.exited;
}
