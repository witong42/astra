import {
  type ChildProcessWithoutNullStreams,
  execFileSync,
  spawn,
} from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SpeechEvent } from "./voice";

const MAX_FRAME_BYTES = 128 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const LEVEL_INTERVAL_MS = 150;
const PEAK_MAX = 32767;
const RUNTIME_ENVIRONMENT = {
  GST_PLUGIN_PATH: "",
  GST_PLUGIN_PATH_1_0: "",
  GST_PLUGIN_SYSTEM_PATH: "",
  GST_PLUGIN_SYSTEM_PATH_1_0: "",
  GST_REGISTRY: process.platform === "win32" ? "NUL" : "/dev/null",
  GST_REGISTRY_UPDATE: "no",
  GST_REGISTRY_FORK: "no",
};
type Frame = {
  type: string;
  sdp?: string;
  state?: { microphonePeak: number; speakerPeak: number };
};

export class CodexLiveMedia {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buffer = Buffer.alloc(0);
  private pending: {
    expected: string;
    resolve: (frame: Frame) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private queue = Promise.resolve();
  private levels: ReturnType<typeof setInterval> | undefined;
  private readingLevel = false;
  constructor(
    private executable: string,
    private onEvent: (event: SpeechEvent) => void,
  ) {}

  async offer() {
    if (!existsSync(this.executable))
      throw new Error(
        "Codex voice runtime is missing. Install the current Codex CLI.",
      );
    const root = join(dirname(realpathSync(this.executable)), "..");
    const helper = join(
      root,
      "codex-resources/voice/bin",
      process.platform === "win32"
        ? "codex-voice-host.exe"
        : "codex-voice-host",
    );
    if (!existsSync(helper))
      throw new Error(
        "Codex voice runtime is missing. Install the complete current Codex CLI package.",
      );
    const buildCommit = execFileSync(helper, ["--build-commit"], {
      encoding: "utf8",
      timeout: REQUEST_TIMEOUT_MS,
    }).trim();
    if (!/^[a-f0-9]{40}$/.test(buildCommit))
      throw new Error(
        "Codex voice runtime has an unknown build. Reinstall Codex.",
      );
    const child = spawn(helper, [], {
      cwd: root,
      env: { ...process.env, ...RUNTIME_ENVIRONMENT },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    child.stderr.on("data", () => {});
    child.stdout.on("data", (chunk: Buffer) => this.receive(chunk));
    child.stdin.on("error", (error) => this.failed(error));
    child.on("error", (error) => this.failed(error));
    child.on("exit", () => {
      if (this.child === child)
        this.failed(
          new Error(
            "Codex voice stopped. Check your microphone, then start Astra again.",
          ),
        );
    });
    await this.request({ type: "hello", protocol: 1, buildCommit }, "ready");
    await this.request({ type: "initializeRuntime" }, "runtimeReady");
    const offer = await this.request({ type: "startTransport" }, "offer");
    if (!offer.sdp)
      throw new Error("Codex voice did not provide a connection offer.");
    return offer.sdp;
  }

  async answer(sdp: string) {
    await this.request({ type: "applyAnswer", sdp }, "transportReady");
    await this.request(
      {
        type: "openDevices",
        selection: { microphone: null, speaker: null, channel: null },
      },
      "devicesOpened",
    );
    await this.muteOutput(false);
    this.levels = setInterval(() => {
      if (this.readingLevel) return;
      this.readingLevel = true;
      void this.request({ type: "inspectAudio" }, "audioState")
        .then((frame) => {
          if (this.child && frame.state)
            this.onEvent({
              method: "voice/level",
              level: Math.min(
                1,
                Math.max(frame.state.microphonePeak, frame.state.speakerPeak) /
                  PEAK_MAX,
              ),
            });
        })
        .catch((error) => {
          if (this.child) this.failed(error);
        })
        .finally(() => {
          this.readingLevel = false;
        });
    }, LEVEL_INTERVAL_MS);
    this.levels.unref?.();
  }

  async muteOutput(muted: boolean) {
    await this.request(
      {
        type: "setAudioControls",
        controls: { microphoneMuted: false, speakerSuppressed: muted },
      },
      "audioControlsApplied",
    );
  }

  private request(message: object, expected: string): Promise<Frame> {
    const result = this.queue.then(
      () =>
        new Promise<Frame>((resolve, reject) => {
          if (!this.child) {
            reject(new Error("Codex voice is not connected."));
            return;
          }
          const timer = setTimeout(
            () =>
              this.failed(
                new Error(
                  `Codex voice timed out waiting for ${expected}. Start the voice session again.`,
                ),
              ),
            REQUEST_TIMEOUT_MS,
          );
          this.pending = { expected, resolve, reject, timer };
          const body = Buffer.from(JSON.stringify(message));
          const header = Buffer.alloc(4);
          header.writeUInt32BE(body.length);
          this.child.stdin.write(Buffer.concat([header, body]));
        }),
    );
    this.queue = result.then(
      () => {},
      () => {},
    );
    return result;
  }

  private receive(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32BE(0);
      if (size > MAX_FRAME_BYTES) {
        this.failed(new Error("Codex voice sent an oversized response."));
        return;
      }
      if (this.buffer.length < size + 4) return;
      let frame: Frame;
      try {
        frame = JSON.parse(this.buffer.subarray(4, size + 4).toString());
      } catch {
        this.failed(new Error("Codex voice sent an invalid response."));
        return;
      }
      this.buffer = this.buffer.subarray(size + 4);
      const pending = this.pending;
      if (!pending || frame.type !== pending.expected) {
        this.failed(
          new Error(
            "Codex voice lost its connection. Start the voice session again.",
          ),
        );
        return;
      }
      this.pending = null;
      clearTimeout(pending.timer);
      pending.resolve(frame);
    }
  }

  private failed(error: Error) {
    const active = this.child !== null;
    this.stop();
    if (active) this.onEvent({ method: "voice/error", message: error.message });
  }

  stop() {
    clearInterval(this.levels);
    this.levels = undefined;
    const pending = this.pending;
    this.pending = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(new Error("Codex voice stopped."));
    }
    const child = this.child;
    this.child = null;
    child?.stdin.end();
    child?.kill("SIGTERM");
    this.buffer = Buffer.alloc(0);
  }
}
