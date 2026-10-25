import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CAPTURE_TEST_TIMEOUT_MS = 35_000;
const FRAME_COUNT = 50;

test(
  "Electron captures mono audio in the background and releases the microphone across restarts",
  async () => {
    const root = join(import.meta.dir, "..");
    const directory = mkdtempSync(join(tmpdir(), "astra-capture-test-"));
    let child: ReturnType<typeof Bun.spawn> | undefined;
    try {
      const result = join(directory, "result.json");
      const entry = join(directory, "probe.ts");
      writeFileSync(
        entry,
        [
          "import {app,BrowserWindow} from 'electron';",
          "import {writeFileSync} from 'node:fs';",
          `import {audioWindow} from ${JSON.stringify(join(root, "src/audio-window.ts"))};`,
          `import {RendererAudio} from ${JSON.stringify(join(root, "src/renderer-audio.ts"))};`,
          `app.setPath('userData',${JSON.stringify(join(directory, "profile"))});`,
          "app.commandLine.appendSwitch('use-fake-device-for-media-stream');",
          "app.commandLine.appendSwitch('use-fake-ui-for-media-stream');",
          "app.on('window-all-closed',()=>{});",
          "app.whenReady().then(async()=>{app.dock?.hide();",
          `const createHost=audioWindow(${JSON.stringify(join(root, "dist"))});`,
          "const audio=new RendererAudio(async receive=>{",
          "const host=await createHost(receive);",
          "await BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(" +
            JSON.stringify(
              "const acquire=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async options=>{window.captureRequest=options;window.captureStream=await acquire(options);return window.captureStream};void 0;",
            ) +
            ");",
          "return host;});",
          "const results=[];",
          "try{for(let cycle=0;cycle<2;cycle++){",
          "let frames=0,peak=0,resolve,reject;",
          "const received=new Promise((yes,no)=>{resolve=yes;reject=no});",
          "await audio.start(pcm=>{frames++;for(const sample of pcm)peak=Math.max(peak,Math.abs(sample));" +
            "if(frames>=" +
            FRAME_COUNT +
            "&&peak>0.001)resolve()},event=>{if(event.method==='voice/error')reject(new Error(event.message))});",
          "await received;",
          "const host=BrowserWindow.getAllWindows()[0];",
          "const visible=host.isVisible();",
          "const capture=await host.webContents.executeJavaScript(" +
            JSON.stringify(
              "({constraints:window.captureRequest,settings:window.captureStream.getAudioTracks()[0].getSettings(),state:window.captureStream.getAudioTracks()[0].readyState})",
            ) +
            ");",
          "audio.stop();",
          "results.push({frames,peak,visible,capture,remaining:BrowserWindow.getAllWindows().length});",
          "}",
          `writeFileSync(${JSON.stringify(result)},JSON.stringify(results));`,
          "}finally{audio.stop()}app.quit();",
          "}).catch(error=>{console.error(error);app.exit(1)});",
        ].join("\n"),
      );
      const build = await Bun.build({
        entrypoints: [entry],
        outdir: directory,
        target: "node",
        format: "cjs",
        naming: "probe.cjs",
        external: ["electron"],
      });
      if (!build.success) throw new AggregateError(build.logs);
      const environment = { ...process.env };
      delete environment.ELECTRON_RUN_AS_NODE;
      const captureProcess = Bun.spawn(
        [require("electron"), join(directory, "probe.cjs")],
        {
          env: environment,
          stdout: "ignore",
          stderr: "pipe",
        },
      );
      child = captureProcess;
      const timer = setTimeout(
        () => child?.kill(),
        CAPTURE_TEST_TIMEOUT_MS - 1000,
      );
      const [code, stderr] = await Promise.all([
        captureProcess.exited,
        new Response(captureProcess.stderr).text(),
      ]);
      clearTimeout(timer);
      expect({ code, error: code ? stderr : null }).toEqual({
        code: 0,
        error: null,
      });
      const captures = JSON.parse(readFileSync(result, "utf8"));
      expect(captures).toHaveLength(2);
      for (const capture of captures) {
        expect(capture.frames).toBeGreaterThanOrEqual(FRAME_COUNT);
        expect(capture.peak).toBeGreaterThan(0.001);
        expect(capture.visible).toBe(false);
        expect(capture.remaining).toBe(0);
        expect(capture.capture.state).toBe("live");
        expect(capture.capture.constraints).toEqual({
          audio: {
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
          video: false,
        });
        expect(capture.capture.settings.channelCount).toBe(1);
        expect(capture.capture.settings.echoCancellation).toBe(true);
      }
    } finally {
      child?.kill();
      rmSync(directory, { recursive: true, force: true });
    }
  },
  CAPTURE_TEST_TIMEOUT_MS,
);
