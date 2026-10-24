import { expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexLiveMedia } from "../src/live-media";

test("Codex media opens muted devices after negotiation and releases the helper", async () => {
  const root = mkdtempSync(join(tmpdir(), "astra-live-media-"));
  const bin = join(root, "bin");
  const helperDirectory = join(root, "codex-resources/voice/bin");
  mkdirSync(bin, { recursive: true });
  mkdirSync(helperDirectory, { recursive: true });
  const cli = join(bin, "codex");
  writeFileSync(cli, "fixture");
  const helper = join(helperDirectory, "codex-voice-host");
  writeFileSync(
    helper,
    `#!/usr/bin/env bun
if(process.argv.includes('--build-commit')) { console.log('a'.repeat(40)); process.exit(0); }
const send=value=>{const body=Buffer.from(JSON.stringify(value));const header=Buffer.alloc(4);header.writeUInt32BE(body.length);process.stdout.write(Buffer.concat([header,body]));};
let buffer=Buffer.alloc(0),negotiated=false;
process.stdin.on('data',chunk=>{buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=4&&buffer.length>=4+buffer.readUInt32BE()){
 const size=buffer.readUInt32BE();const value=JSON.parse(buffer.subarray(4,size+4).toString());buffer=buffer.subarray(size+4);
 const responses={hello:'ready',initializeRuntime:'runtimeReady',startTransport:'offer',applyAnswer:'transportReady',openDevices:'devicesOpened',setAudioControls:'audioControlsApplied',inspectAudio:'audioState',close:'closed'};
 if(value.type==='applyAnswer')negotiated=true;
 if(value.type==='openDevices'&&!negotiated)process.exit(2);
 send({type:responses[value.type],...(value.type==='startTransport'?{sdp:'test-offer'}:{}),...(value.type==='inspectAudio'?{state:{microphonePeak:1000,speakerPeak:0}}:{})});
 if(value.type==='close')process.exit(0);
}});
`,
  );
  chmodSync(helper, 0o700);
  const errors: string[] = [];
  const media = new CodexLiveMedia(cli, (event) => {
    if (event.method === "voice/error") errors.push(event.message);
  });
  try {
    expect(await media.offer()).toBe("test-offer");
    await media.answer("test-answer");
    await media.muteOutput(true);
    await media.muteOutput(false);
    expect(errors).toEqual([]);
  } finally {
    media.stop();
    rmSync(root, { recursive: true });
  }
});

test("missing Codex voice runtime produces an actionable error", async () => {
  const media = new CodexLiveMedia("/missing/codex", () => {});
  await expect(media.offer()).rejects.toThrow("Codex voice");
  media.stop();
});
