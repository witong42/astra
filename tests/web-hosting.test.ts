import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const PROBE_TIMEOUT_MS = 5000;
const TEST_TIMEOUT_MS = 15_000;
const INJECTED_FRAME_PROBE =
  "const nested=document.createElement('iframe');document.body.append(nested);void(nested.contentDocument||nested.contentWindow.document);";

test.skipIf(process.platform !== "darwin")(
  "hosted sandbox canvases retain scripts and shared data without cross-origin errors",
  async () => {
    const project = join(import.meta.dir, "..");
    const directory = mkdtempSync(join(tmpdir(), "astra-hosting-test-"));
    let server: ReturnType<typeof Bun.serve> | undefined;
    try {
      const build = Bun.spawnSync(
        [process.execPath, join(project, "scripts/build-web.ts")],
        { cwd: project, stdout: "pipe", stderr: "pipe" },
      );
      if (build.exitCode !== 0)
        throw new Error(new TextDecoder().decode(build.stderr));
      const { default: worker } = await import(
        pathToFileURL(join(project, "dist/server/index.js")).href
      );
      const response: Response = worker.fetch(
        new Request("https://astra.example/canvas.html"),
      );
      const canvas = await response.text();
      const noTransform = response.headers
        .get("cache-control")
        ?.includes("no-transform");
      const captured = process.env.ASTRA_TEST_HOSTED_CANVAS;
      const hosted = captured
        ? await Bun.file(captured).text()
        : noTransform
          ? canvas
          : canvas.replace(
              "</body>",
              `<script>${INJECTED_FRAME_PROBE}</script></body>`,
            );
      const fixture =
        '<main id="substrate"><button id="increment">Add</button><output id="counter">0</output><output id="weather">12°</output><script>(()=>{let count=0;document.getElementById("increment").onclick=()=>{document.getElementById("counter").textContent=String(++count)}})()</script></main>';
      const harness = `window.probe=new Promise(resolve=>{const errors=[];let clicked=false,complete=false;const finish=()=>resolve({functional:complete,errors});const timer=setTimeout(finish,${PROBE_TIMEOUT_MS});addEventListener('message',event=>{const frame=document.querySelector('iframe');if(event.source!==frame?.contentWindow)return;const value=event.data;if(value.type==='canvas:error')errors.push(value.error);if(value.type==='canvas:ready')frame.contentWindow.postMessage({type:'canvas:init',html:${JSON.stringify(fixture)},css:'',revision:0},'*');if(value.type==='canvas:snapshot'){if(!clicked&&value.html.includes('id="counter">0')){clicked=true;frame.contentWindow.postMessage({type:'canvas:control',requestId:'click',request:{action:'click',selector:'#increment'}},'*');}if(value.html.includes('id="counter">1')&&value.html.includes('id="weather">12°')){complete=true;clearTimeout(timer);setTimeout(finish,300);}}});});`;
      server = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(request) {
          const path = new URL(request.url).pathname;
          if (path === "/probe.js")
            return new Response(harness, {
              headers: { "Content-Type": "text/javascript" },
            });
          if (path === "/canvas.html")
            return new Response(hosted, {
              headers: {
                "Content-Type": "text/html",
                ...(noTransform ? { "Cache-Control": "no-transform" } : {}),
              },
            });
          return new Response(
            '<!doctype html><body><script src="/probe.js"></script><iframe sandbox="allow-scripts" src="/canvas.html"></iframe></body>',
            { headers: { "Content-Type": "text/html" } },
          );
        },
      });
      const entry = join(directory, "main.cjs");
      writeFileSync(
        entry,
        `const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(join(directory, "profile"))});app.whenReady().then(async()=>{const window=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false}});try{await window.loadURL(${JSON.stringify(server.url.href)});const result=await window.webContents.executeJavaScript('window.probe');console.log('SANDBOX_PROBE '+JSON.stringify(result));app.quit();}catch(error){console.error(error);app.exit(1);}});`,
      );
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const child = Bun.spawn(
        [
          join(
            project,
            "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
          ),
          entry,
        ],
        { env, stdout: "pipe", stderr: "pipe" },
      );
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      expect({ code, error: code ? stderr : null }).toEqual({
        code: 0,
        error: null,
      });
      const line = stdout
        .split("\n")
        .find((value) => value.startsWith("SANDBOX_PROBE "));
      if (!line) throw new Error("The sandbox probe returned no result.");
      const result = JSON.parse(line.slice("SANDBOX_PROBE ".length));
      console.log(line);
      expect(result.functional).toBe(true);
      expect(result.errors).toEqual([]);
    } finally {
      server?.stop(true);
      rmSync(directory, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);
