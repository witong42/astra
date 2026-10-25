import { expect, spyOn, test } from "bun:test";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { desktopClient } from "../scripts/desktop-client";

const PROBE_TIMEOUT_MS = 5000;
const POLL_INTERVAL_MS = 50;
const TEST_TIMEOUT_MS = 15_000;

test.each([
  new URL("../dist/index.html", import.meta.url).href,
  "file:///C:/Users/Voice%20Test/AppData/Local/Programs/Astra/0.4.0/resources/app/dist/index.html",
  "file:///tmp/release/Astra.app/Contents/Resources/app/dist/index.html",
])("desktop checks connect to checkout or Windows package: %s", async (url) => {
  const socketUrl = "ws://127.0.0.1:9337/devtools/page/astra";
  const fetch = spyOn(globalThis, "fetch").mockResolvedValue(
    Response.json([
      {
        id: "astra",
        url,
        webSocketDebuggerUrl: socketUrl,
      },
    ]),
  );
  const original = globalThis.WebSocket;
  let connected = "";
  let closed = false;
  class Socket {
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    constructor(url: string) {
      connected = url;
      queueMicrotask(() => this.onopen?.());
    }
    send(data: string) {
      const message = JSON.parse(data);
      expect(message.method).toBe("Runtime.enable");
      this.onmessage?.({
        data: JSON.stringify({ id: message.id, result: {} }),
      });
    }
    close() {
      closed = true;
    }
  }
  globalThis.WebSocket = Socket as unknown as typeof WebSocket;
  try {
    const client = await desktopClient();
    expect(connected).toBe(socketUrl);
    client.close();
    expect(closed).toBe(true);
  } finally {
    globalThis.WebSocket = original;
    fetch.mockRestore();
  }
});

test.skipIf(process.platform !== "darwin")(
  "the orb appearance check inspects the current canvas in an isolated browser",
  async () => {
    const project = join(import.meta.dir, "..");
    const directory = realpathSync(
      mkdtempSync(join(tmpdir(), "astra-orb-test-")),
    );
    try {
      const fixture = join(directory, "dist/index.html");
      mkdirSync(join(directory, "dist"));
      mkdirSync(join(directory, "scripts"));
      symlinkSync(join(project, "src"), join(directory, "src"), "dir");
      symlinkSync(
        join(project, "node_modules"),
        join(directory, "node_modules"),
        "dir",
      );
      mkdirSync(join(directory, "test-results"));
      for (const file of ["desktop-client.ts", "verify-orb.ts"])
        copyFileSync(
          join(project, "scripts", file),
          join(directory, "scripts", file),
        );
      writeFileSync(
        fixture,
        `<!doctype html><style>${await Bun.file(join(project, "src/styles.css")).text()}</style><body></body>`,
      );
      const profile = join(directory, "profile");
      const ready = join(directory, "ready");
      const entry = join(directory, "main.cjs");
      writeFileSync(
        entry,
        `const {app,BrowserWindow}=require('electron');
        const fs=require('node:fs');
        app.setPath('userData',${JSON.stringify(profile)});
        app.commandLine.appendSwitch('remote-debugging-port','0');
        app.whenReady().then(async()=>{
          const window=new BrowserWindow({show:false});
          try{
            await window.loadFile(${JSON.stringify(fixture)});
            fs.rmSync(${JSON.stringify(join(profile, "DevToolsActivePort"))},{force:true});
            fs.writeFileSync(${JSON.stringify(ready)},'ready');
          }catch(error){console.error(error);app.exit(1)}
        });`,
      );
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const browser = Bun.spawn(
        [
          join(
            project,
            "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
          ),
          entry,
        ],
        { env, stdout: "pipe", stderr: "pipe" },
      );
      let output = "";
      const diagnostics = (async () => {
        const decoder = new TextDecoder();
        for await (const chunk of browser.stderr)
          output += decoder.decode(chunk, { stream: true });
        return output;
      })();
      const debuggerPort = () =>
        output.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//)?.[1];
      try {
        const deadline = Date.now() + PROBE_TIMEOUT_MS;
        while (!(await Bun.file(ready).exists()) || !debuggerPort()) {
          if (browser.exitCode !== null) throw new Error(await diagnostics);
          if (Date.now() >= deadline) {
            browser.kill();
            await browser.exited;
            throw new Error(
              `The isolated orb browser did not start (page ready: ${await Bun.file(ready).exists()}, debugger ready: ${Boolean(debuggerPort())}). ${await diagnostics}`,
            );
          }
          await Bun.sleep(POLL_INTERVAL_MS);
        }
        const port = Number(debuggerPort());
        expect(port).toBeGreaterThan(0);
        const preload = join(directory, "preload.ts");
        writeFileSync(
          preload,
          `const networkFetch=globalThis.fetch;globalThis.fetch=(input,options)=>networkFetch(String(input)==='http://127.0.0.1:9337/json/list'?'http://127.0.0.1:${port}/json/list':input,options);`,
        );
        const probe = Bun.spawn(
          [
            process.execPath,
            "--preload",
            preload,
            join(directory, "scripts/verify-orb.ts"),
          ],
          { cwd: directory, env, stdout: "pipe", stderr: "pipe" },
        );
        const timer = setTimeout(() => probe.kill(), PROBE_TIMEOUT_MS);
        try {
          const [code, stdout, stderr] = await Promise.all([
            probe.exited,
            new Response(probe.stdout).text(),
            new Response(probe.stderr).text(),
          ]);
          expect({ code, error: code ? stderr : null }).toEqual({
            code: 0,
            error: null,
          });
          expect(stdout).toContain("ORB_VERIFIED");
        } finally {
          clearTimeout(timer);
          probe.kill();
        }
      } finally {
        browser.kill();
        await browser.exited;
        await diagnostics;
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);
