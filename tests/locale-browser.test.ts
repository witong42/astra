import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildCanvas } from "../scripts/build-canvas";
import { appIcon, copyBrand } from "../scripts/icon";
import { newWorkspace } from "../src/storage";
import type { Snapshot } from "../src/types";
import { INITIAL_VOICE, type VoiceState } from "../src/voice";

const BROWSER_TIMEOUT_MS = 30_000;
const PROJECT = join(import.meta.dir, "..");

async function browserProbe(config: {
  directory: string;
  snapshot: Snapshot;
  voice: VoiceState;
  evidence: string;
}) {
  const { app, BrowserWindow, ipcMain } =
    require("electron") as typeof import("electron");
  const assert: typeof import("node:assert/strict") = require("node:assert/strict");
  const fs = require("node:fs") as typeof import("node:fs");
  app.setPath("userData", `${config.directory}/profile`);
  const timeout = setTimeout(() => app.exit(2), 25_000);
  process.stdin.resume();
  process.stdin.on("end", () => app.exit(3));
  await app.whenReady();
  const states = new Map<number, Snapshot>();
  const voices = new Map<number, VoiceState>();
  const calls = new Map<number, { method: string; args: unknown[] }[]>();
  for (const method of [
    "snapshot",
    "voiceSnapshot",
    "remoteActive",
    "updateSnapshot",
    "checkForUpdates",
    "installUpdate",
    "selectWorkspace",
    "updateCanvas",
    "updateOpenUI",
    "chooseFolder",
    "deleteWorkspace",
    "startVoice",
    "stopVoice",
    "pauseVoice",
  ]) {
    ipcMain.handle(`astra:${method}`, (event, ...args) => {
      const state = states.get(event.sender.id);
      assert.ok(state);
      calls.get(event.sender.id)?.push({ method, args });
      if (method === "snapshot") return state;
      if (method === "voiceSnapshot") return voices.get(event.sender.id);
      if (method === "updateSnapshot") return { status: "idle" };
      if (method === "checkForUpdates") {
        const update = { status: "ready", version: "9.8.7", percent: 100 };
        event.sender.send("astra:update", update);
        return update;
      }
      if (method === "pauseVoice" || method === "startVoice") {
        const voice = {
          ...config.voice,
          active: true,
          status: method === "pauseVoice" ? "standby" : "listening",
        } as VoiceState;
        voices.set(event.sender.id, voice);
        event.sender.send("astra:voice", voice);
      }
      if (method === "remoteActive") return false;
      if (method === "selectWorkspace") {
        state.activeId = String(args[0]);
        event.sender.send("astra:snapshot", state);
      }
      if (method === "updateCanvas") {
        const canvas = state.workspaces.find(
          (entry) => entry.id === args[0],
        )?.canvas;
        assert.ok(canvas);
        Object.assign(canvas, args[1]);
      }
      if (method === "updateOpenUI") {
        const ui = state.workspaces.find((entry) => entry.id === args[0])
          ?.canvas?.openui;
        assert.ok(ui);
        ui.state = args[2];
      }
      return false;
    });
  }
  const errors: string[] = [];
  const createDevice = async (
    device: string,
    width: number,
    height: number,
  ) => {
    const window = new BrowserWindow({
      show: false,
      useContentSize: true,
      width,
      height,
      webPreferences: {
        preload: `${config.directory}/preload.cjs`,
        partition: `persist:${device}`,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    states.set(window.webContents.id, structuredClone(config.snapshot));
    voices.set(window.webContents.id, structuredClone(config.voice));
    calls.set(window.webContents.id, []);
    window.webContents.on("console-message", (details) => {
      if (
        details.level === "error" &&
        !details.message.includes("Electron Security Warning")
      )
        errors.push(details.message);
    });
    await window.loadFile(`${config.directory}/index.html`);
    if (device === "phone") {
      window.webContents.debugger.attach("1.3");
      await window.webContents.debugger.sendCommand(
        "Emulation.setTouchEmulationEnabled",
        { enabled: true, maxTouchPoints: 5 },
      );
      await window.webContents.executeJavaScript(
        "void (document.documentElement.dataset.platform='web')",
      );
    }
    return window;
  };
  const desktop = await createDevice("mac", 1440, 960);
  const phone = await createDevice("phone", 393, 852);
  fs.mkdirSync(config.evidence, { recursive: true });
  for (const [device, window] of [
    ["mac", desktop],
    ["phone", phone],
  ] as const) {
    const evaluate = <T = unknown>(expression: string) =>
      window.webContents.executeJavaScript(expression, true) as Promise<T>;
    const waitFor = async (expression: string) => {
      const deadline = Date.now() + 5000;
      while (!(await evaluate(`Boolean(${expression})`))) {
        assert.ok(Date.now() < deadline, `Timed out: ${expression}`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    const click = (selector: string) =>
      evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
    const control = (request: object) =>
      evaluate(`window.astraControl(${JSON.stringify(request)})`);
    const fill = (selector: string, value: string) =>
      evaluate(
        `(()=>{const field=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(field instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype,'value').set.call(field,${JSON.stringify(value)});field.dispatchEvent(new Event('input',{bubbles:true}))})()`,
      );
    const screenshot = async (name: string) => {
      await evaluate(
        "document.getAnimations().filter(animation=>Number.isFinite(animation.effect?.getComputedTiming().iterations)).forEach(animation=>animation.finish())",
      );
      await evaluate(
        "document.fonts.ready.then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(null)))))",
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      fs.writeFileSync(
        `${config.evidence}/${device}-${name}.json`,
        JSON.stringify(
          await evaluate(
            "({width:innerWidth,height:innerHeight,scrollX,scrollY,nodes:Object.fromEntries(['.desktop-body','.home-content','.astra','.horizon-library','.journal-drawer','.canvas-frame'].map(selector=>{const e=document.querySelector(selector),r=e?.getBoundingClientRect(),s=e&&getComputedStyle(e);return [selector,r&&{x:r.x,y:r.y,width:r.width,height:r.height,visibility:s.visibility,transform:s.transform,scrollLeft:e.scrollLeft}]}))})",
          ),
          null,
          2,
        ),
      );
      fs.writeFileSync(
        `${config.evidence}/${device}-${name}.png`,
        (await window.webContents.capturePage()).toPNG(),
      );
    };
    await waitFor(
      "document.querySelector('.language-switch button[aria-pressed=true]')?.textContent==='FR'&&typeof window.astraControl==='function'",
    );
    await screenshot("fr-home");
    for (const workspace of config.snapshot.workspaces.filter(
      (entry) => entry.canvas?.generation,
    )) {
      const hybrid = Boolean(workspace.canvas?.openui);
      await control({ action: "open", id: workspace.id });
      await waitFor("document.querySelector('iframe.canvas-frame')");
      const selector = `${hybrid ? "canvas:" : ""}#fixture-note`;
      await control({
        action: "fill",
        id: workspace.id,
        selector,
        value: "Saisie conservée",
      });
      await control({
        action: "click",
        id: workspace.id,
        selector: `${hybrid ? "canvas:" : ""}#fixture-counter`,
      });
      if (hybrid)
        await fill(
          '.openui-surface textarea[name="notes"]',
          "Notes OpenUI conservées",
        );
      await click("#chat-toggle");
      await fill(".composer textarea", "Brouillon conservé");
      await evaluate(
        "void (window.localeFrame=document.querySelector('iframe.canvas-frame'));void (window.localeDraft=document.querySelector('.composer textarea'))",
      );
      await click('.language-switch button[lang="en"]');
      await waitFor("document.documentElement.lang==='en'");
      assert.equal(
        await evaluate("document.querySelector('.composer textarea').value"),
        "Brouillon conservé",
      );
      assert.equal(
        await evaluate("document.querySelector('.desktop-body').scrollLeft"),
        0,
      );
      assert.equal(
        await evaluate(
          "document.querySelector('iframe.canvas-frame')===window.localeFrame&&document.querySelector('.composer textarea')===window.localeDraft",
        ),
        true,
      );
      assert.equal(
        await evaluate(
          "document.querySelector('.astra-home-orb').getAttribute('aria-description')",
        ),
        "Listening",
      );
      assert.equal(
        await evaluate("document.querySelector('.journal-day').textContent"),
        "4 January 2026",
      );
      assert.equal(
        await evaluate(
          "document.querySelector('.journal-entry .message-text').textContent",
        ),
        "Bonjour, garde cette phrase.",
      );
      const inspected = JSON.stringify(
        await control({ action: "inspect", id: workspace.id }),
      );
      assert.ok(
        inspected.includes("Saisie conservée") && inspected.includes("Count 1"),
      );
      if (hybrid)
        assert.equal(
          await evaluate(
            "document.querySelector('.openui-surface textarea[name=\"notes\"]').value",
          ),
          "Notes OpenUI conservées",
        );
      if (!hybrid) {
        await click("#chat-toggle");
        await waitFor(
          "document.querySelector('.journal-drawer.open')&&!document.querySelector('.journal-drawer').inert",
        );
        await click(".journal-tools .workspace-menu-trigger");
        await evaluate(
          "Array.from(document.querySelectorAll('.journal-tools .workspace-menu .workspace-menu-item')).find(button=>button.textContent.trim()==='Rename').click()",
        );
        await fill(".workspace-name-input", "Nom intact");
        await click('.language-switch button[lang="fr"]');
        await waitFor("document.documentElement.lang==='fr'");
        assert.equal(
          await evaluate(
            "document.querySelector('.workspace-name-input').value",
          ),
          "Nom intact",
        );
        assert.equal(
          await evaluate(
            "document.querySelector('.workspace-menu form label').textContent",
          ),
          "Nom de la mini-app",
        );
        await evaluate(
          "document.querySelectorAll('[popover]:popover-open').forEach(menu=>menu.hidePopover())",
        );
        await click('.language-switch button[lang="en"]');
        await waitFor("document.documentElement.lang==='en'");
        await screenshot("en-journal");
      }
      await evaluate(
        "window.astra.chooseFolder();window.astra.deleteWorkspace(" +
          JSON.stringify(workspace.id) +
          ")",
      );
      assert.deepEqual(
        calls
          .get(window.webContents.id)
          ?.filter((call) => call.method === "chooseFolder")
          .at(-1)?.args,
        ["en"],
      );
      assert.deepEqual(
        calls
          .get(window.webContents.id)
          ?.filter((call) => call.method === "deleteWorkspace")
          .at(-1)?.args,
        [workspace.id, "en"],
      );
      await click('.language-switch button[lang="fr"]');
      await waitFor("document.documentElement.lang==='fr'");
      await control({ action: "home" });
    }
    await click('.language-switch button[lang="en"]');
    await waitFor("document.documentElement.lang==='en'");
    await screenshot("en-home");
    const geometry = await evaluate<{
      left: number;
      right: number;
      bottom: number;
      height: number;
      width: number;
    }>(
      "(()=>{const r=document.querySelector('.language-switch').getBoundingClientRect();return {left:r.left,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}})()",
    );
    assert.ok(
      geometry.left >= 0 &&
        geometry.right <= geometry.width &&
        geometry.bottom <= geometry.height,
    );
    if (device === "phone") {
      assert.equal(
        await evaluate("matchMedia('(pointer: coarse)').matches"),
        true,
      );
      assert.equal(
        await evaluate(
          "Array.from(document.querySelectorAll('.language-switch button')).every(button=>{const r=button.getBoundingClientRect();return r.width>=44&&r.height>=40})",
        ),
        true,
      );
    }
    if (device === "mac")
      assert.equal(
        await phone.webContents.executeJavaScript(
          "document.documentElement.lang",
        ),
        "fr",
      );
    await window.reload();
    await waitFor(
      "document.documentElement.lang==='en'&&document.querySelector('.language-switch button[lang=en]')?.getAttribute('aria-pressed')==='true'&&typeof window.astraControl==='function'",
    );
    assert.equal(
      calls
        .get(window.webContents.id)
        ?.filter(
          (call) => call.method === "startVoice" || call.method === "stopVoice",
        ).length,
      0,
    );
    await click(".astra-avatar");
    await waitFor(
      "document.querySelector('.astra-avatar')?.getAttribute('aria-pressed')==='false'",
    );
    assert.equal(
      await evaluate(
        "document.querySelector('.astra-avatar').getAttribute('aria-label')",
      ),
      "Talk to Astra",
    );
    await click(".astra-avatar");
    await waitFor(
      "document.querySelector('.astra-avatar')?.getAttribute('aria-pressed')==='true'",
    );
    assert.deepEqual(
      calls
        .get(window.webContents.id)
        ?.filter((call) =>
          ["pauseVoice", "startVoice", "stopVoice"].includes(call.method),
        )
        .map((call) => call.method),
      ["pauseVoice", "startVoice"],
    );
    const blank = config.snapshot.workspaces.find(
      (entry) => !entry.canvas?.generation,
    );
    assert.ok(blank);
    await control({ action: "open", id: blank.id });
    assert.equal(
      await evaluate(
        "document.querySelector('.empty-workspace h2').textContent",
      ),
      "What will you make?",
    );
    await click('.language-switch button[lang="fr"]');
    await waitFor("document.documentElement.lang==='fr'");
    assert.equal(
      await evaluate(
        "document.querySelector('.empty-workspace h2').textContent",
      ),
      "Que veux-tu créer ?",
    );
    if (device === "mac") {
      await control({ action: "home" });
      if (
        !(await evaluate(
          "document.querySelector('#chat-toggle').getAttribute('aria-expanded')==='true'",
        ))
      )
        await click("#chat-toggle");
      await click("button.app-release");
      await waitFor(
        "document.querySelector('.update-button')?.textContent==='Redémarrer pour mettre à jour'",
      );
      assert.equal(
        await evaluate("document.querySelector('.update-button').disabled"),
        true,
      );
      await click(".update-button");
      assert.equal(
        calls
          .get(window.webContents.id)
          ?.filter((call) => call.method === "installUpdate").length,
        0,
      );
      const paused = {
        ...config.voice,
        active: true,
        status: "standby",
      } as VoiceState;
      voices.set(window.webContents.id, paused);
      window.webContents.send("astra:voice", paused);
      await waitFor(
        "document.querySelector('.update-button').disabled===false",
      );
      await click('.language-switch button[lang="en"]');
      await waitFor(
        "document.querySelector('.update-button')?.textContent==='Restart to update'",
      );
      await screenshot("en-update");
      await click(".update-button");
      await waitFor(
        "document.querySelector('.update-button').disabled===false",
      );
      assert.equal(
        calls
          .get(window.webContents.id)
          ?.filter((call) => call.method === "installUpdate").length,
        1,
      );
    }
  }
  assert.deepEqual(errors, []);
  clearTimeout(timeout);
  console.log(
    "LOCALE_BROWSER_VERIFIED",
    JSON.stringify({
      devices: 2,
      languages: 2,
      canvas: true,
      openui: true,
      drafts: true,
      rename: true,
      persistence: true,
      independentDevices: true,
      updates: true,
      voiceRestarts: 0,
      errors: 0,
    }),
  );
  app.exit(0);
}

test.skipIf(process.platform !== "darwin")(
  "the real renderer switches and persists each device's interface language without remounting inputs or canvases or restarting voice",
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "astra-locale-test-"));
    try {
      const plain = newWorkspace("/tmp");
      plain.name = "Mon app française";
      if (!plain.canvas)
        throw new Error("A new workspace must include a canvas.");
      plain.canvas.generation = 1;
      plain.canvas.html =
        '<main id="substrate"><h1>Contenu original</h1><label>Notes<textarea id="fixture-note"></textarea></label><button id="fixture-counter" data-count="0">Count 0</button><script>document.querySelector("#fixture-counter").onclick=function(){this.dataset.count=String(Number(this.dataset.count)+1);this.textContent="Count "+this.dataset.count}</script></main>';
      plain.canvas.css =
        "body{padding:24px;font:16px system-ui;background:#f6f7f9;color:#172232}textarea{display:block;margin:12px 0;padding:12px;width:90%}button{padding:12px}";
      const hybrid = structuredClone(plain);
      hybrid.id = crypto.randomUUID();
      hybrid.name = "Vue hybride";
      if (!hybrid.canvas)
        throw new Error("The hybrid fixture requires a canvas.");
      hybrid.canvas.openui = {
        source:
          'root = Stack([Heading("Contenu OpenUI"), notes, scene])\n$notes = ""\nnotes = Input("notes", "Notes originales", $notes, true)\nscene = LiveCanvas({}, 220)',
        state: { notes: "" },
      };
      const blank = newWorkspace("/tmp");
      const snapshot: Snapshot = {
        version: 1,
        activeId: plain.id,
        model: "test",
        reasoningEffort: "low",
        serviceTier: "default",
        workspaces: [plain, hybrid, blank],
        sessions: {},
        status: "ready",
        activity: "Ready",
        account: "",
        backendVersion: "test",
        models: [],
        approval: null,
        error: null,
        metrics: null,
        journal: [
          {
            id: "journal",
            at: Date.UTC(2026, 0, 4, 12),
            kind: "user",
            source: "voice",
            text: "Bonjour, garde cette phrase.",
          },
        ],
      };
      for (const [entry, target, naming] of [
        ["renderer.tsx", "browser", "renderer.js"],
        ["preload.ts", "node", "preload.cjs"],
      ] as const) {
        const result = await Bun.build({
          entrypoints: [join(PROJECT, "src", entry)],
          outdir: directory,
          naming,
          target,
          format: target === "node" ? "cjs" : "esm",
          external: target === "node" ? ["electron"] : [],
          minify: true,
        });
        if (!result.success)
          throw new AggregateError(result.logs, `Could not build ${entry}`);
      }
      await buildCanvas(PROJECT, directory);
      copyBrand(PROJECT, directory);
      await Bun.write(join(directory, "icon.png"), appIcon().png);
      await Bun.write(
        join(directory, "styles.css"),
        Bun.file(join(PROJECT, "src/styles.css")),
      );
      await Bun.write(
        join(directory, "index.html"),
        Bun.file(join(PROJECT, "src/index.html")),
      );
      const entry = join(directory, "main.cjs");
      await Bun.write(
        entry,
        `(${browserProbe.toString()})(${JSON.stringify({ directory, snapshot, voice: { ...INITIAL_VOICE, active: true, language: "fr", status: "listening" }, evidence: join(PROJECT, "test-results/locale") })}).catch(error=>{console.error(error);require('electron').app.exit(1)})`,
      );
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const browser = Bun.spawn(
        [
          join(
            PROJECT,
            "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
          ),
          entry,
        ],
        { env, stdin: "pipe", stdout: "pipe", stderr: "pipe" },
      );
      try {
        const [code, output, errors] = await Promise.all([
          browser.exited,
          new Response(browser.stdout).text(),
          new Response(browser.stderr).text(),
        ]);
        if (code !== 0)
          throw new Error(
            `Locale browser probe failed (${code}): ${output}\n${errors}`,
          );
        expect(output).toContain("LOCALE_BROWSER_VERIFIED");
      } finally {
        browser.kill();
        await browser.exited;
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  BROWSER_TIMEOUT_MS,
);
