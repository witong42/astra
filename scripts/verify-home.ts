import assert from "node:assert/strict";
import { join } from "node:path";
import { astraConfig } from "../src/config";
import { initialJournal } from "../src/journal";
import { loadState, newWorkspace, saveState } from "../src/storage";
import type { Snapshot } from "../src/types";
import { desktopClient } from "./desktop-client";

const PROFILE = process.env.ASTRA_DATA_DIR ?? "/tmp/astra-home-check";
const ROOT = join(import.meta.dir, "..");
const MARKDOWN =
  '# Your weekly plan\n\n**Keep it focused.** Choose three priorities and leave room to think.\n\n1. Finish the orbit lab\n2. Plan the next release\n\n- [x] Create the canvas\n- [ ] Review the details\n\n| Project | Status |\n| --- | --- |\n| Orbit lab | Ready |\n| Planner | In progress |\n\n```ts\nconst priority = "Make one useful thing";\nconst veryLongLine = "' +
  "a".repeat(120) +
  '";\n```\n\nRead the [source](https://example.com/docs).\n\n<script>window.markdownExecuted = true</script>\n\n[Unsafe](javascript:alert%281%29)';
if (process.argv.includes("--prepare")) {
  const state = loadState(
    join(astraConfig().dataDirectory, "workspace.json"),
    ROOT,
  );
  const planner = newWorkspace(ROOT);
  planner.name = "Weekly planner";
  planner.favorite = true;
  assert.ok(planner.canvas);
  planner.canvas.generation = 1;
  planner.canvas.html =
    '<main id="substrate"><p class="eyebrow">A LITTLE FOCUS</p><h1>This week, on purpose.</h1><p>Three priorities. Space to think. A fresh start whenever you need it.</p><section><h2>Small steps count.</h2><button id="home-counter" data-count="0">Count 0</button><label for="home-notes">Notes</label><textarea id="home-notes" placeholder="What needs your attention?"></textarea></section><script>(()=>{const b=document.getElementById("home-counter");b.addEventListener("click",()=>{const count=Number(b.dataset.count)+1;b.dataset.count=String(count);b.textContent="Count "+count;});})()</script></main>';
  planner.canvas.css =
    "body{background:#f7f8f3;padding:64px 7vw;font:15px -apple-system,sans-serif;color:#29372d}#substrate{max-width:900px;margin:auto}.eyebrow{font-size:11px;letter-spacing:.16em;color:#73816d}h1{font-size:52px;letter-spacing:-.05em;font-weight:550;margin:20px 0}p{line-height:1.8;color:#677461}section{margin-top:48px;padding-top:32px;border-top:1px solid #dce2d6}h2{font-size:22px;font-weight:500}button{border:0;background:#526b52;color:white;padding:12px 20px;border-radius:8px;cursor:pointer}label{display:block;margin:24px 0 10px}textarea{box-sizing:border-box;display:block;width:100%;min-height:130px;border:1px solid #d4ddce;background:#fff;border-radius:10px;padding:16px;font:inherit}";
  planner.messages = [
    { id: crypto.randomUUID(), role: "user", text: "Help me plan the week." },
    { id: crypto.randomUUID(), role: "assistant", text: MARKDOWN },
  ];
  const orbit = newWorkspace(ROOT);
  orbit.name = "Orbit lab";
  orbit.favorite = true;
  orbit.canvas = structuredClone(planner.canvas);
  orbit.canvas.html = '<main id="substrate"><h1>Orbit Lab</h1></main>';
  const notes = newWorkspace(ROOT);
  notes.name = "Life dashboard";
  notes.favorite = true;
  notes.canvas = structuredClone(planner.canvas);
  const blank = newWorkspace(ROOT);
  state.workspaces = [orbit, planner, notes, blank];
  state.activeId = planner.id;
  state.assistant = newWorkspace(ROOT);
  state.assistant.name = "Astra";
  state.voiceEnabled = false;
  state.journal = undefined;
  state.journal = initialJournal(state);
  state.journal.push(
    {
      id: "qa-voice",
      at: Date.now(),
      kind: "user",
      source: "voice",
      text: "Astra, ouvre le planning.",
      workspaceId: state.assistant.id,
    },
    {
      id: "qa-action",
      at: Date.now(),
      kind: "action",
      source: "tool",
      text: "Mini-app ouverte · Weekly planner",
      workspaceId: planner.id,
      status: "completed",
    },
  );
  saveState(join(PROFILE, "workspace.json"), state);
  console.log(
    "HOME_PROFILE_PREPARED",
    JSON.stringify({
      profile: PROFILE,
      model: state.model,
      effort: state.reasoningEffort,
      tier: state.serviceTier,
    }),
  );
  process.exit(0);
}

const client = await desktopClient();
let frame: Awaited<ReturnType<typeof desktopClient>> | undefined;
const snapshot = () => client.evaluate<Snapshot>("window.astra.snapshot()");
async function wait<T>(
  read: () => Promise<T>,
  check: (value: T) => boolean,
  description: string,
) {
  for (let attempt = 0; attempt < 200; attempt++) {
    const value = await read();
    if (check(value)) return value;
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
const click = (selector: string) =>
  client.evaluate(
    `document.querySelector(${JSON.stringify(selector)}).click()`,
  );
const visible = (selector: string) =>
  client.evaluate<boolean>(
    `(()=>{const e=document.querySelector(${JSON.stringify(selector)});return !!e&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none'})()`,
  );
try {
  const initial = await wait(
    snapshot,
    (state) => state.status === "ready",
    "Codex connection",
  );
  const planner = initial.workspaces.find(
    (workspace) => workspace.name === "Weekly planner",
  );
  assert.ok(planner);
  assert.equal(await visible(".home-screen"), true);
  assert.equal(
    await client.evaluate("document.querySelectorAll('.app-tile').length"),
    4,
  );
  assert.equal(
    await client.evaluate("document.querySelectorAll('.library-row').length"),
    4,
  );
  assert.equal(
    await client.evaluate(
      "document.querySelector('.home-screen').dataset.layout",
    ),
    "horizon",
  );
  assert.equal(
    await client.evaluate(
      "document.querySelectorAll('.desktop-toolbar button').length",
    ),
    3,
  );
  await client.screenshot("test-results/home-wide.png");
  await click("#chat-toggle");
  await wait(
    () => client.evaluate("document.activeElement?.getAttribute('aria-label')"),
    (value) => value === "Message Astra",
    "Home journal focus",
  );
  await wait(
    () =>
      client.evaluate(
        "Math.abs(document.querySelector('.chat-drawer').getBoundingClientRect().right-innerWidth)<1",
      ),
    Boolean,
    "right journal position",
  );
  assert.equal(
    await client.evaluate(
      "document.querySelector('.journal-history').textContent.includes('Astra, ouvre le planning.')",
    ),
    true,
  );
  assert.equal(
    await client.evaluate(
      "document.querySelector('.journal-result.completed').textContent.includes('Effectuée')",
    ),
    true,
  );
  await client.screenshot("test-results/home-journal.png");
  await click(".close-chat");
  await click(`.app-tile[data-workspace-id="${planner.id}"]`);
  await wait(
    () => visible(".home-screen"),
    (value) => !value,
    "full-screen app",
  );
  assert.equal(
    await client.evaluate("document.querySelector('.chat-drawer').inert"),
    true,
  );
  frame =
    (await wait(
      async () => {
        try {
          return await desktopClient("canvas", planner.id);
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
      "app iframe",
    )) ?? undefined;
  assert.ok(frame);
  const origin = await frame.evaluate("performance.timeOrigin");
  const fullWidth = await client.evaluate(
    "document.querySelector('.app-stage').getBoundingClientRect().width",
  );
  assert.equal(fullWidth, await client.evaluate("innerWidth"));
  await frame.evaluate(
    "document.getElementById('home-counter').click(); const notes=document.getElementById('home-notes');notes.value='Keep this app state';notes.dispatchEvent(new Event('input',{bubbles:true}));",
  );
  await client.evaluate("window.astraFlush()");
  await click("#chat-toggle");
  await wait(
    () => client.evaluate("document.activeElement?.getAttribute('aria-label')"),
    (value) => value === "Message Astra",
    "composer focus",
  );
  assert.equal(
    await client.evaluate(
      "document.querySelector('.app-stage').getBoundingClientRect().width",
    ),
    fullWidth,
  );
  assert.equal(await frame.evaluate("performance.timeOrigin"), origin);
  const markdown = await client.evaluate<{
    heading: boolean;
    bold: boolean;
    table: boolean;
    code: boolean;
    scripts: number;
    unsafe: number;
    longCodeScrolls: boolean;
    historyContained: boolean;
  }>(
    `(()=>{const m=document.querySelector('.message.assistant .message-text'),pre=m.querySelector('pre'),history=document.querySelector('.messages');return {heading:!!m.querySelector('h1'),bold:!!m.querySelector('strong'),table:!!m.querySelector('table'),code:!!pre?.querySelector('code'),scripts:m.querySelectorAll('script,img').length,unsafe:m.querySelectorAll('a[href^="javascript:"],a[href^="file:"]').length,longCodeScrolls:pre.scrollWidth>pre.clientWidth,historyContained:history.scrollWidth<=history.clientWidth}})()`,
  );
  assert.deepEqual(markdown, {
    heading: true,
    bold: true,
    table: true,
    code: true,
    scripts: 0,
    unsafe: 0,
    longCodeScrolls: true,
    historyContained: true,
  });
  await client.call("Input.insertText", {
    text: "Draft kept while I use the app",
  });
  await client.screenshot("test-results/home-chat-markdown.png");
  await client.call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Escape",
    code: "Escape",
    windowsVirtualKeyCode: 27,
  });
  await wait(
    () => client.evaluate("document.querySelector('.chat-drawer').inert"),
    Boolean,
    "drawer closes with Escape",
  );
  assert.equal(
    await client.evaluate("document.activeElement.id"),
    "chat-toggle",
  );
  await click(".home-button");
  await wait(() => visible(".home-screen"), Boolean, "Home return");
  await click(`.app-tile[data-workspace-id="${planner.id}"]`);
  await wait(
    () => visible(".home-screen"),
    (value) => !value,
    "app reopens",
  );
  assert.equal(await frame.evaluate("performance.timeOrigin"), origin);
  assert.equal(
    await frame.evaluate("document.getElementById('home-counter').textContent"),
    "Count 1",
  );
  await click("#chat-toggle");
  await wait(
    () => client.evaluate("document.querySelector('.chat-drawer').inert"),
    (value) => !value,
    "chat reopens",
  );
  assert.equal(
    await client.evaluate("document.querySelector('.composer textarea').value"),
    "Draft kept while I use the app",
  );
  await click(".close-chat");
  await click(".home-button");
  await wait(() => visible(".home-screen"), Boolean, "Home before favorites");
  for (const workspace of initial.workspaces.filter(
    (workspace) => workspace.favorite,
  ))
    await client.evaluate(
      `window.astra.setFavorite(${JSON.stringify(workspace.id)},false)`,
    );
  await wait(
    () => client.evaluate("document.querySelectorAll('.app-tile').length"),
    (count) => count === 4,
    "all apps remain visible without favorites",
  );
  await client.evaluate(
    `window.astra.setFavorite(${JSON.stringify(planner.id)},true)`,
  );
  await wait(
    () => client.evaluate("document.querySelectorAll('.app-tile').length"),
    (count) => count === 4,
    "favorite added",
  );
  await client.evaluate("window.astraFlush()");
  await Bun.sleep(350);
  const saved = loadState(join(PROFILE, "workspace.json"), ROOT);
  assert.equal(
    saved.workspaces.find((workspace) => workspace.id === planner.id)?.favorite,
    true,
  );
  await client.call("Page.reload");
  await wait(() => visible(".home-screen"), Boolean, "Home on reload");
  assert.equal(
    await client.evaluate("document.querySelectorAll('.app-tile').length"),
    4,
  );
  for (const [width, height] of [
    [1440, 920],
    [960, 650],
  ]) {
    await client.call("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    assert.equal(
      await client.evaluate(
        "document.documentElement.scrollWidth<=innerWidth && document.querySelector('.home-screen').scrollWidth<=innerWidth",
      ),
      true,
    );
    await client.screenshot(`test-results/home-${width}.png`);
    await click(`.app-tile[data-workspace-id="${planner.id}"]`);
    await wait(
      () => visible(".home-screen"),
      (value) => !value,
      "responsive app",
    );
    await click("#chat-toggle");
    await Bun.sleep(200);
    const layout = await client.evaluate<{
      bottom: number;
      height: number;
      centerError: number;
      canvasWidth: number;
      width: number;
      historyContained: boolean;
    }>(
      `(()=>{const drawer=document.querySelector('.chat-drawer').getBoundingClientRect(),composer=document.querySelector('.composer').getBoundingClientRect(),history=document.querySelector('.messages');return {bottom:composer.bottom,height:innerHeight,centerError:Math.abs(drawer.x+drawer.width/2-composer.x-composer.width/2),canvasWidth:document.querySelector('.app-stage').getBoundingClientRect().width,width:innerWidth,historyContained:history.scrollWidth<=history.clientWidth}})()`,
    );
    assert.ok(layout.bottom < layout.height);
    assert.ok(layout.centerError < 2);
    assert.equal(layout.canvasWidth, layout.width);
    assert.equal(layout.historyContained, true);
    await click(".home-button");
    await wait(
      () => visible(".home-screen"),
      Boolean,
      "responsive Home return",
    );
  }
  await client.call("Emulation.clearDeviceMetricsOverride");
  await click("#chat-toggle");
  await click('.journal-tools [aria-label="Créer une mini-app"]');
  const next = await wait(
    snapshot,
    (state) => state.activeId !== planner.id,
    "new app workspace",
  );
  await wait(
    () => visible(".home-screen"),
    (value) => !value,
    "new app opens",
  );
  assert.equal(
    await client.evaluate("document.querySelector('.chat-drawer').inert"),
    false,
  );
  assert.deepEqual(
    [next.model, next.reasoningEffort, next.serviceTier],
    [initial.model, initial.reasoningEffort, initial.serviceTier],
  );
  assert.equal(client.errors.length, 0);
  const result = {
    homeOnLaunch: true,
    horizonLayout: true,
    journalOnHomeAndRight: true,
    voiceAndActionHistory: true,
    favoritesPersist: true,
    fullScreenCanvas: true,
    drawerKeepsCanvasSize: true,
    appStateAndDraftPreserved: true,
    markdownSafe: true,
    responsive: true,
    newAppOpensChat: true,
    settingsUnchanged: true,
    errors: 0,
  };
  await Bun.write(
    "test-results/home-verification.json",
    JSON.stringify(result, null, 2),
  );
  console.log("HOME_VERIFIED", JSON.stringify(result));
} finally {
  frame?.close();
  client.close();
}
