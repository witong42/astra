import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_CANVAS_BYTES } from "../src/canvas";
import { loadState, saveState } from "../src/storage";
import type { Snapshot } from "../src/types";
import { desktopClient, showWorkspace } from "./desktop-client";

const root = join(import.meta.dir, "..");
const profile = mkdtempSync(join(tmpdir(), "codexos-canvas-size-check-"));
const wire = join(profile, "requests.jsonl");
const fake = join(profile, "fake-codex");
const timeoutMs = 10_000;
const baseline = process.argv.includes("--baseline");
const state = loadState(join(profile, "workspace.json"), root);
const workspace = state.workspaces[0];
assert.ok(workspace.canvas);
workspace.canvas.html =
  '<main id="substrate"><h1>Canvas recovery</h1><div id="payload"></div></main>';
workspace.favorite = true;
saveState(join(profile, "workspace.json"), state);
await Bun.write(wire, "");
await Bun.write(
  fake,
  `#!/usr/bin/env bun
import {appendFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
if(process.argv.includes('--version')){console.log('codex-cli size-test');process.exit(0)}
const send=m=>process.stdout.write(JSON.stringify(m)+'\\n');
const threadId='size-test-thread';
const turnId='size-test-turn';
createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line);
 appendFileSync(${JSON.stringify(wire)},line+'\\n');
 if(m.method==='initialize')send({id:m.id,result:{}});
 if(m.method==='account/read')send({id:m.id,result:{account:{type:'chatgpt',planType:'test'}}});
 if(m.method==='model/list')send({id:m.id,result:{data:[{id:'test',model:'test',displayName:'Test',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}],serviceTiers:[]}]}});
 if(m.method==='config/read')send({id:m.id,result:{config:{model:'test'}}});
 if(m.method==='thread/start')send({id:m.id,result:{thread:{id:threadId}}});
 if(m.method==='turn/start')send({id:m.id,result:{turn:{id:turnId}}});
 if(m.method==='turn/steer'){
  send({id:m.id,result:{turnId}});
  const patch={op:'replace',sel:'#substrate',html:'<main id="substrate"><h1 id="repaired">Canvas recovered</h1></main>'};
  send({method:'item/agentMessage/delta',params:{threadId,itemId:'repair',delta:'Chat stayed available.\\n'+JSON.stringify(patch)+'\\n'}});
  send({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed'}}});
 }
});
`,
);
chmodSync(fake, 0o700);
const electron = Bun.spawn(
  [
    join(root, "node_modules/.bin/electron"),
    baseline ? "/Applications/CodexOS.app/Contents/Resources/app" : root,
    "--remote-debugging-port=9337",
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      CODEXOS_DATA_DIR: profile,
      CODEXOS_CODEX_PATH: fake,
      CODEXOS_TEST_HIDDEN: "1",
    },
    stdout: "ignore",
    stderr: "ignore",
  },
);
let app: Awaited<ReturnType<typeof desktopClient>> | undefined;
let canvas: Awaited<ReturnType<typeof desktopClient>> | undefined;
async function waitFor<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  label: string,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (ready(value)) return value;
    await Bun.sleep(50);
  }
  throw new Error(`Canvas size verification timed out: ${label}.`);
}
const requests = () =>
  readFileSync(wire, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
async function send(text: string) {
  assert.ok(app);
  await app.evaluate("document.querySelector('.composer textarea').focus()");
  await app.call("Input.insertText", { text });
  await app.evaluate("document.querySelector('.send-button').click()");
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
  const client = app;
  await waitFor(
    () => client.evaluate<Snapshot>("window.codexos.snapshot()"),
    (snapshot) => snapshot.status === "ready",
    "test backend",
  );
  await showWorkspace(app, true);
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
  const surface = canvas;
  await app.evaluate("window.codexosFlush()");
  await canvas.evaluate(
    `document.getElementById('payload').textContent='x'.repeat(${MAX_CANVAS_BYTES + 100})`,
  );
  await send("Explain this app");
  const saveErrorVisible = await waitFor(
    () =>
      client.evaluate(
        "document.querySelector('.error-banner')?.textContent.includes('canvas') ?? false",
      ),
    Boolean,
    "visible save warning",
  );
  console.log("OVERFLOW_WARNING_REVIEW", JSON.stringify({ saveErrorVisible }));
  await waitFor(
    async () => requests().some((request) => request.method === "turn/start"),
    Boolean,
    "chat while capture exceeds its limit",
  );
  assert.ok(
    await app.evaluate(
      "document.querySelector('.error-banner').textContent.includes('Chat')",
    ),
    "A failed save must remain visible without blocking chat",
  );
  await waitFor(
    () => client.evaluate("document.querySelector('.composer textarea').value"),
    (value) => value === "",
    "accepted message clears its draft",
  );
  await send("Repair the canvas");
  await waitFor(
    async () => requests().some((request) => request.method === "turn/steer"),
    Boolean,
    "guidance while capture exceeds its limit",
  );
  await waitFor(
    () => surface.evaluate("!!document.getElementById('repaired')"),
    Boolean,
    "repair of a canvas that grew beyond its save limit",
  );
  await waitFor(
    () => client.evaluate<Snapshot>("window.codexos.snapshot()"),
    (snapshot) =>
      !snapshot.sessions[workspace.id]?.busy &&
      snapshot.workspaces[0].canvas?.pending.length === 0,
    "repair acknowledgment",
  );
  await canvas.evaluate(
    "document.getElementById('substrate').append(Object.assign(document.createElement('div'),{id:'large-saved',textContent:'é'.repeat(650000)}))",
  );
  await app.evaluate("window.codexosFlush()");
  const saved = await app.evaluate<Snapshot>("window.codexos.snapshot()");
  const document = saved.workspaces[0].canvas;
  assert.ok(document);
  assert.ok(Buffer.byteLength(document.html) > 512 * 1024);
  await send("Explain the large canvas");
  await waitFor(
    async () =>
      requests().filter((request) => request.method === "turn/start").length ===
      2,
    Boolean,
    "bounded context for a large saved canvas",
  );
  const last = requests()
    .filter((request) => request.method === "turn/start")
    .at(-1);
  assert.ok(last.params.input[0].text.includes('"truncated":true'));
  await app.evaluate("window.codexosFlush()");
  await app.evaluate("document.querySelector('.home-button').click()");
  await waitFor(
    () => client.evaluate("!!document.querySelector('.home-screen')"),
    Boolean,
    "Home remains available",
  );
  assert.equal(app.errors.length, 0);
  assert.equal(canvas.errors.length, 0);
  console.log(
    "CANVAS_SIZE_VERIFIED",
    JSON.stringify({
      canvasLimitBytes: MAX_CANVAS_BYTES,
      chatAfterFailedCapture: true,
      steeringAfterFailedCapture: true,
      oversizedRuntimeRepaired: true,
      largeCanvasSaved: true,
      largeContextBounded: true,
      navigationAvailable: true,
      modelCalls: 0,
    }),
  );
} finally {
  if (canvas)
    await canvas
      .evaluate(
        "document.getElementById('substrate').innerHTML='<p>QA complete</p>'",
      )
      .catch(() => {});
  await app?.evaluate("window.codexosFlush()").catch(() => {});
  canvas?.close();
  app?.close();
  electron.kill("SIGKILL");
  await electron.exited;
  rmSync(profile, { recursive: true, force: true });
}
