import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { z } from "zod";
import { PcmFramer } from "./phone-audio";
import { RpcPeer } from "./rpc";
import type { SpeechEvent } from "./voice";

const CAPTURE_TIMEOUT_MS = 30_000;
const frameSchema = z.object({
  method: z.literal("audio/frame"),
  pcm: z.string().min(4).max(128_000),
  sampleRate: z.number().min(8000).max(192_000),
});
export class NativeAudio {
  private child: ChildProcessWithoutNullStreams | null = null;
  private rpc: RpcPeer | null = null;
  constructor(private executable: string) {}
  async start(
    onFrame: (pcm: Float32Array) => void,
    onEvent: (event: SpeechEvent) => void,
  ) {
    if (!existsSync(this.executable))
      throw new Error("The microphone helper is missing. Rebuild Astra.");
    const child = spawn(this.executable, [], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    let framer: PcmFramer | null = null;
    let rate = 0;
    const rpc = new RpcPeer(
      child.stdout,
      child.stdin,
      (message) => {
        if (this.rpc !== rpc) return;
        try {
          if (message.method === "voice/error") {
            onEvent({
              method: "voice/error",
              message: z.string().parse(message.params?.message),
            });
            return;
          }
          const frame = frameSchema.parse({
            method: message.method,
            ...message.params,
          });
          if (rate !== frame.sampleRate) {
            if (framer)
              throw new Error(
                "The microphone changed sample rate. Restart voice.",
              );
            rate = frame.sampleRate;
            framer = new PcmFramer(rate);
          }
          const bytes = Buffer.from(frame.pcm, "base64");
          if (bytes.length % Float32Array.BYTES_PER_ELEMENT)
            throw new Error("Invalid microphone PCM frame.");
          const samples = new Float32Array(
            bytes.length / Float32Array.BYTES_PER_ELEMENT,
          );
          for (let i = 0; i < samples.length; i++)
            samples[i] = bytes.readFloatLE(i * Float32Array.BYTES_PER_ELEMENT);
          for (const pcm of framer?.push(samples) ?? []) onFrame(pcm);
        } catch (error) {
          onEvent({
            method: "voice/error",
            message: `Microphone capture failed: ${String(error)}`,
          });
        }
      },
      CAPTURE_TIMEOUT_MS,
      () => {
        if (this.rpc === rpc)
          onEvent({
            method: "voice/error",
            message: "The Mac microphone stopped. Restart voice.",
          });
      },
    );
    this.rpc = rpc;
    child.stderr.on("data", () => {});
    child.on("error", (error) => rpc.close(error));
    child.on("exit", () => rpc.close());
    await rpc.request("start", {});
  }
  stop() {
    const rpc = this.rpc;
    this.rpc = null;
    rpc?.close();
    this.child?.stdin.end();
    this.child?.kill("SIGTERM");
    this.child = null;
  }
}
