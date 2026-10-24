import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { z } from "zod";
import { RpcPeer } from "./rpc";
import type { Speech, SpeechEvent } from "./voice";

const SPEECH_REQUEST_TIMEOUT_MS = 120_000;
const MAX_PHONE_AUDIO_BYTES = 64_000;
const phoneAudioSchema = z
  .string()
  .min(4)
  .max(85_336)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);
const eventSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.enum(["voice/partial", "voice/final"]),
    text: z.string().max(24_000),
    language: z.enum(["en", "fr"]).optional(),
  }),
  z.object({
    method: z.enum(["voice/speaking", "voice/finished"]),
    speechId: z.number().int(),
  }),
  z.object({ method: z.enum(["voice/wake", "voice/home"]) }),
  z.object({
    method: z.literal("voice/shortcut"),
    text: z.string().max(160),
    language: z.enum(["en", "fr"]),
  }),
  z.object({ method: z.literal("voice/level"), level: z.number().finite() }),
  z.object({ method: z.literal("voice/error"), message: z.string().max(2000) }),
]);
export class NativeSpeech implements Speech {
  private child: ChildProcessWithoutNullStreams | null = null;
  private rpc: RpcPeer | null = null;
  private ready = false;
  constructor(
    private executable: string,
    private onEvent: (event: SpeechEvent) => void,
    private input: "microphone" | "phone" = "microphone",
  ) {}
  async start(standby = false, homeOnly = false) {
    if (!existsSync(this.executable))
      throw new Error(
        "The voice helper is missing. Rebuild Astra to enable voice.",
      );
    const child = spawn(this.executable, [], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    const rpc = new RpcPeer(
      child.stdout,
      child.stdin,
      (message) => {
        const result = eventSchema.safeParse({
          method: message.method,
          ...message.params,
        });
        if (result.success) this.onEvent(result.data);
        else
          this.onEvent({
            method: "voice/error",
            message:
              "macOS sent an invalid speech response. Restart the voice session.",
          });
      },
      SPEECH_REQUEST_TIMEOUT_MS,
      () => {
        if (this.rpc === rpc)
          this.onEvent({
            method: "voice/error",
            message:
              "The macOS voice connection stopped. Start the voice session again.",
          });
      },
    );
    this.rpc = rpc;
    child.stderr.on("data", () => {});
    child.on("error", (error) => rpc.close(error));
    child.on("exit", () => rpc.close());
    await rpc.request("start", {
      standby,
      homeOnly,
      external: this.input === "phone",
    });
    if (this.rpc === rpc) this.ready = true;
  }
  async appendAudio(pcm: string) {
    if (this.input !== "phone")
      throw new Error("Phone audio requires an external speech input.");
    const data = Buffer.from(phoneAudioSchema.parse(pcm), "base64");
    if (
      data.length === 0 ||
      data.length > MAX_PHONE_AUDIO_BYTES ||
      data.length % Float32Array.BYTES_PER_ELEMENT !== 0
    )
      throw new Error(
        "Phone audio must contain at most one second of mono Float32 audio.",
      );
    if (!this.ready || !this.rpc) return false;
    const result = await this.rpc.request("audio", { pcm });
    return z.object({ accepted: z.boolean() }).parse(result).accepted;
  }
  async listen() {
    await this.rpc?.request("listen", {});
  }
  async standby() {
    await this.rpc?.request("standby", {});
  }
  async speak(text: string, speechId: number, language: "en" | "fr") {
    if (!this.rpc) throw new Error("The voice session is not active.");
    await this.rpc.request("speak", { text, speechId, language });
  }
  async interrupt() {
    await this.rpc?.request("interrupt", {});
  }
  stop() {
    this.ready = false;
    const rpc = this.rpc;
    this.rpc = null;
    rpc?.close();
    this.child?.stdin.end();
    this.child?.kill("SIGTERM");
    this.child = null;
  }
}
