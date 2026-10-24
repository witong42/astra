import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const PROBE_TIMEOUT_MS = 8000;
const TEST_TIMEOUT_MS = 25_000;
const SLOW_UPLOAD_MS = 1400;

for (const uploadDelay of [0, SLOW_UPLOAD_MS]) {
  test.skipIf(process.platform !== "darwin")(
    `a real audio stream stays connected during a ${uploadDelay}ms Mac upload delay`,
    async () => {
      const project = join(import.meta.dir, "..");
      const directory = mkdtempSync(join(tmpdir(), "astra-output-test-"));
      let server: ReturnType<typeof Bun.serve> | undefined;
      let child: ReturnType<typeof Bun.spawn> | undefined;
      try {
        const probe = join(directory, "probe.ts");
        writeFileSync(
          probe,
          `import { WebAudio } from ${JSON.stringify(join(project, "src/web-audio.ts"))};
        window.checkOutput = async () => {
          const errors = [], blocked = [];
          const uploads = [];
          const audio = new WebAudio(async(_id,pcm)=>{uploads.push(atob(pcm).length);await new Promise(resolve=>setTimeout(resolve,${uploadDelay}));}, ()=>{}, error=>errors.push(error.message), error=>{if(error)blocked.push(error)});
          const remote = new RTCPeerConnection();
          const source = new AudioContext();
          const tone = source.createOscillator();
          try {
            const microphone = audio.prepare();
            await source.resume();
            const destination = source.createMediaStreamDestination();
            tone.frequency.value = 440;
            tone.connect(destination);
            tone.start();
            for (const track of destination.stream.getTracks()) remote.addTrack(track, destination.stream);
            const captureId = await microphone;
            const callId = crypto.randomUUID();
            const sdp = await audio.command({kind:'audio',action:'offer',captureId,callId});
            await remote.setRemoteDescription({type:'offer',sdp});
            await remote.setLocalDescription(await remote.createAnswer());
            await new Promise((resolve,reject)=>{
              const timer=setTimeout(()=>reject(new Error('Remote ICE timed out')),${PROBE_TIMEOUT_MS});
              const changed=()=>{if(remote.iceGatheringState==='complete'){clearTimeout(timer);remote.removeEventListener('icegatheringstatechange',changed);resolve()}};
              remote.addEventListener('icegatheringstatechange',changed);changed();
            });
            await audio.command({kind:'audio',action:'answer',captureId,callId,sdp:remote.localDescription.sdp});
            const deadline = performance.now() + ${PROBE_TIMEOUT_MS};
            let status;
            do {
              status = await audio.diagnostics();
              if(status.inbound?.energy > 0 && status.output?.readyState >= 2 && !status.output.paused) break;
              await new Promise(resolve=>setTimeout(resolve,50));
            } while(performance.now()<deadline);
            if (${uploadDelay}>0) await new Promise(resolve=>setTimeout(resolve,${uploadDelay}*2));
            status = await audio.diagnostics();
            return {status,errors,blocked,uploads};
          } finally {
            audio.stop();remote.close();tone.stop();await source.close();
          }
        };`,
        );
        const build = await Bun.build({
          entrypoints: [probe, join(project, "src/audio-worklet.ts")],
          outdir: directory,
          target: "browser",
          naming: "[name].js",
        });
        if (!build.success) throw new AggregateError(build.logs);
        server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch(request) {
            const path = new URL(request.url).pathname;
            if (path === "/probe.js" || path === "/audio-worklet.js")
              return new Response(Bun.file(join(directory, path.slice(1))), {
                headers: { "Content-Type": "text/javascript" },
              });
            return new Response(
              '<!doctype html><script type="module" src="/probe.js"></script>',
              { headers: { "Content-Type": "text/html" } },
            );
          },
        });
        const entry = join(directory, "main.cjs");
        writeFileSync(
          entry,
          `const {app,BrowserWindow}=require('electron');
        app.setPath('userData',${JSON.stringify(join(directory, "profile"))});
        app.commandLine.appendSwitch('use-fake-device-for-media-stream');
        app.commandLine.appendSwitch('use-fake-ui-for-media-stream');
        app.whenReady().then(async()=>{
          const window=new BrowserWindow({show:false,webPreferences:{backgroundThrottling:false,autoplayPolicy:'document-user-activation-required'}});
          window.webContents.setAudioMuted(true);
          window.webContents.session.setPermissionRequestHandler((contents,permission,callback)=>callback(permission==='media'));
          try {
            await window.loadURL(${JSON.stringify(server.url.href)});
            const result=await window.webContents.executeJavaScript('window.checkOutput()',true);
            console.log('AUDIO_OUTPUT_PROBE '+JSON.stringify(result));app.quit();
          } catch(error) {console.error(error);app.exit(1);}
        });`,
        );
        const env = { ...process.env };
        delete env.ELECTRON_RUN_AS_NODE;
        const probeProcess = Bun.spawn(
          [
            join(
              project,
              "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron",
            ),
            entry,
          ],
          { env, stdout: "pipe", stderr: "pipe" },
        );
        child = probeProcess;
        const timer = setTimeout(() => child?.kill(), TEST_TIMEOUT_MS - 1000);
        const [code, stdout, stderr] = await Promise.all([
          probeProcess.exited,
          new Response(probeProcess.stdout).text(),
          new Response(probeProcess.stderr).text(),
        ]);
        clearTimeout(timer);
        expect({ code, error: code ? stderr : null }).toEqual({
          code: 0,
          error: null,
        });
        const line = stdout
          .split("\n")
          .find((value) => value.startsWith("AUDIO_OUTPUT_PROBE "));
        if (!line)
          throw new Error("The audio output probe returned no result.");
        console.log(line);
        const { status, errors, blocked, uploads } = JSON.parse(
          line.slice("AUDIO_OUTPUT_PROBE ".length),
        );
        expect(errors).toEqual([]);
        expect(blocked).toEqual([]);
        expect(status.context).toBe("running");
        expect(status.connection).toBe("connected");
        expect(status.output.paused).toBe(false);
        expect(status.output.muted).toBe(false);
        expect(status.output.blocked).toBe(false);
        expect(status.output.readyState).toBeGreaterThanOrEqual(2);
        expect(status.inbound.bytes).toBeGreaterThan(0);
        expect(status.inbound.energy).toBeGreaterThan(0);
        expect(uploads.every((bytes: number) => bytes <= 64_000)).toBe(true);
        expect(status.localInput.queuedMs).toBeLessThanOrEqual(1000);
        if (uploadDelay > 0)
          expect(status.localInput.discardedMs).toBeGreaterThan(0);
      } finally {
        child?.kill();
        server?.stop(true);
        rmSync(directory, { recursive: true, force: true });
      }
    },
    TEST_TIMEOUT_MS,
  );
}
