import { getCopy } from "./locale";
import { externalWebUrl } from "./navigation";
import type { RemoteCommand, RemoteMethod } from "./remote-server";
import type { Bridge, Snapshot } from "./types";
import { INITIAL_VOICE, type VoiceState } from "./voice";
import { WebAudio } from "./web-audio";

const CALL_TIMEOUT_MS = 60_000;
const AUDIO_UPLOAD_TIMEOUT_MS = 5000;
type RemoteEvent =
  | { type: "ready"; clientId: string }
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "voice"; state: VoiceState; owner: string | null }
  | { type: "command"; id: string | null; command: RemoteCommand };

export class WebBridge {
  readonly bridge: Bridge;
  readonly ready: Promise<Snapshot>;
  private resolveReady!: (snapshot: Snapshot) => void;
  private clientId = crypto.randomUUID();
  private connected = false;
  private latest: Snapshot | null = null;
  private voice: VoiceState = structuredClone(INITIAL_VOICE);
  private lastVoiceError: { message: string; at: number } | null = null;
  private captureId: string | null = null;
  private starting = false;
  private listeners = new Set<(snapshot: Snapshot) => void>();
  private voiceListeners = new Set<(state: VoiceState) => void>();
  private audio: WebAudio;
  private events: EventSource;
  constructor(
    private url: string,
    private connection: (connected: boolean, message?: string) => void,
    playback: (error: string | null) => void = () => {},
  ) {
    this.ready = new Promise((resolve) => {
      this.resolveReady = resolve;
    });
    this.audio = new WebAudio(
      (captureId, pcm) =>
        this.call("voiceAudio", [{ captureId, pcm }], AUDIO_UPLOAD_TIMEOUT_MS),
      (level) => {
        if (this.voice.active) this.publishVoice({ ...this.voice, level });
      },
      (error) => {
        const captureId = this.captureId;
        this.captureId = null;
        this.publishVoice({
          ...INITIAL_VOICE,
          status: "error",
          error: error.message,
        });
        if (captureId && this.connected)
          void this.call("stopVoice", [{ captureId }]).catch((failure) =>
            this.connection(false, String(failure)),
          );
      },
      playback,
    );
    this.events = new EventSource(`${url}/events?clientId=${this.clientId}`);
    this.events.onmessage = (message) => {
      try {
        void this.receive(JSON.parse(message.data)).catch((error) =>
          this.connection(false, String(error)),
        );
      } catch {
        this.connection(false, getCopy().unreadableMac);
      }
    };
    this.events.onerror = () => {
      this.connected = false;
      this.captureId = null;
      this.audio.stop();
      this.publishVoice({
        ...INITIAL_VOICE,
        status: "error",
        error: getCopy().macDisconnected,
      });
      this.connection(false, getCopy().macDisconnected);
      if (this.latest)
        this.publish({
          ...this.latest,
          status: "offline",
          activity: getCopy().macOffline,
          error: getCopy().connectionInterrupted,
        });
    };
    const call = <T = void>(method: RemoteMethod, ...args: unknown[]) =>
      this.call<T>(method, args);
    this.bridge = {
      audioStatus: async () => ({
        ...(await this.audio.diagnostics()),
        ...(this.lastVoiceError
          ? { lastError: { ...this.lastVoiceError } }
          : {}),
      }),
      snapshot: async () => this.call<Snapshot>("snapshot", []),
      subscribe: (listener) => {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      },
      voiceSnapshot: async () => this.voice,
      subscribeVoice: (listener) => {
        this.voiceListeners.add(listener);
        return () => {
          this.voiceListeners.delete(listener);
        };
      },
      startVoice: async (standby = false) => {
        this.lastVoiceError = null;
        this.starting = true;
        let captureId: string | null = null;
        try {
          if (!this.connected) throw new Error(getCopy().reconnectVoice);
          captureId = await this.audio.prepare();
          this.captureId = captureId;
          await call("startVoice", { captureId, standby });
          this.audio.enable(captureId);
        } catch (error) {
          this.publishVoice({
            ...INITIAL_VOICE,
            status: "error",
            error: error instanceof Error ? error.message : String(error),
          });
          if (captureId) {
            this.audio.stop(captureId);
            if (this.captureId === captureId) this.captureId = null;
            void call("stopVoice", { captureId }).catch((failure) =>
              this.connection(false, String(failure)),
            );
          }
          throw error;
        } finally {
          this.starting = false;
        }
      },
      stopVoice: async () => {
        this.lastVoiceError = null;
        const captureId = this.captureId;
        this.captureId = null;
        this.audio.stop();
        if (captureId) await call("stopVoice", { captureId });
      },
      interruptVoice: () => call("interruptVoice"),
      pauseVoice: () => call("pauseVoice"),
      runAppleScript: (id, request) =>
        call<string>("runAppleScript", id, request),
      send: (text, id) => call("send", text, id),
      sendAssistant: (text) => call("sendAssistant", text),
      interrupt: (id) => call("interrupt", id),
      newWorkspace: () => call("newWorkspace"),
      selectWorkspace: (id) => call("selectWorkspace", id),
      setFavorite: (id, favorite) => call("setFavorite", id, favorite),
      renameWorkspace: (id, name) => call("renameWorkspace", id, name),
      deleteWorkspace: async (id) => {
        if (!window.confirm(getCopy().deleteConfirm)) return false;
        return call<boolean>("deleteWorkspace", id, true);
      },
      chooseFolder: async () => {
        const path = window.prompt(
          getCopy().chooseFolderPath,
          this.latest?.workspaces.find(
            (workspace) => workspace.id === this.latest?.activeId,
          )?.cwd ?? "",
        );
        if (path) await call("chooseFolder", path);
      },
      setModel: (model) => call("setModel", model),
      setReasoningEffort: (effort) => call("setReasoningEffort", effort),
      setServiceTier: (tier) => call("setServiceTier", tier),
      updateData: (id, path, value) => call("updateData", id, path, value),
      updateCanvas: (id, ack) => call("updateCanvas", id, ack),
      updateOpenUI: (id, generation, state) =>
        call("updateOpenUI", id, generation, state),
      restoreCanvas: (index, id) => call("restoreCanvas", index, id),
      answer: (allow, answers, id, approvalId) =>
        call("answer", allow, answers, id, approvalId),
      reconnect: async () => {
        if (!this.connected) throw new Error(getCopy().reconnectPhone);
        await call("reconnect");
      },
      openExternal: async (url) => {
        window.open(externalWebUrl(url), "_blank", "noopener,noreferrer");
      },
    };
    window.addEventListener("pagehide", () => {
      this.connected = false;
      this.audio.stop();
      this.events.close();
    });
    window.addEventListener("pageshow", (event) => {
      if (event.persisted) window.location.reload();
    });
  }
  resumeAudio() {
    return this.audio.resumeOutput();
  }
  private publish(snapshot: Snapshot) {
    this.latest = snapshot;
    this.resolveReady(snapshot);
    for (const listener of this.listeners) listener(snapshot);
  }
  private publishVoice(state: VoiceState) {
    if (state.error && state.error !== this.lastVoiceError?.message)
      this.lastVoiceError = { message: state.error, at: Date.now() };
    if (!state.active && this.lastVoiceError)
      state = { ...state, status: "error", error: this.lastVoiceError.message };
    this.voice = state;
    for (const listener of this.voiceListeners) listener(state);
  }
  private async receive(event: RemoteEvent) {
    if (event.type === "ready") {
      this.connected = true;
      this.connection(true);
    } else if (event.type === "snapshot") this.publish(event.snapshot);
    else if (event.type === "voice") {
      const ownsVoice = event.owner === this.clientId;
      const failedCapture =
        event.state.status === "error" && this.captureId !== null;
      if (
        !this.starting &&
        (event.owner !== this.clientId || !event.state.active)
      ) {
        this.audio.stop();
        this.captureId = null;
      }
      this.publishVoice(
        ownsVoice || failedCapture
          ? event.state
          : structuredClone(INITIAL_VOICE),
      );
    } else if (event.type === "command") {
      let receipt: { result: unknown } | { error: string };
      try {
        const command = event.command;
        let result: unknown = null;
        if (command.kind === "audio")
          result = await this.audio.command(command);
        else if (command.kind === "capture") this.audio.stop(command.captureId);
        else if (command.kind === "flush") await window.codexosFlush?.();
        else {
          if (!window.astraControl) throw new Error(getCopy().phoneOpening);
          result = await window.astraControl(command.request);
        }
        receipt = { result: result ?? null };
      } catch (error) {
        receipt = {
          error: (error instanceof Error ? error.message : String(error)).slice(
            0,
            2000,
          ),
        };
      }
      if (event.id)
        await this.post("result", {
          id: event.id,
          clientId: this.clientId,
          ...receipt,
        });
    }
  }
  private async post(path: string, body: unknown, timeout = CALL_TIMEOUT_MS) {
    const response = await fetch(`${this.url}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok || !result.ok)
      throw new Error(result.error ?? getCopy().actionUnconfirmed);
    return result.result;
  }
  private async call<T = void>(
    method: RemoteMethod,
    args: unknown[],
    timeout?: number,
  ): Promise<T> {
    if (!this.connected) throw new Error(getCopy().phoneDisconnected);
    return this.post(
      "call",
      { clientId: this.clientId, method, args },
      timeout,
    );
  }
}
