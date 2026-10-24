import type { CodexBackend } from "./backend";
import type { RpcMessage } from "./rpc";
import type { Snapshot } from "./types";

const IDLE_TIMEOUT_MS = 60_000;
const CONNECTION_TIMEOUT_MS = 30_000;
const WAKE_COMMAND_TIMEOUT_MS = 12_000;
const HOME_OBSERVATION_LIMIT = 16;
const HOME_OBSERVATION_TEXT_LIMIT = 160;
export type VoiceState = {
  active: boolean;
  status:
    | "off"
    | "starting"
    | "standby"
    | "listening"
    | "thinking"
    | "speaking"
    | "error";
  language: "en" | "fr";
  transcript: string;
  task: string;
  reply: string;
  level: number;
  error: string | null;
  workspaceId: string | null;
  homeShortcutReady: boolean;
};
export const INITIAL_VOICE: VoiceState = {
  active: false,
  status: "off",
  language: "fr",
  transcript: "",
  task: "",
  reply: "",
  level: 0,
  error: null,
  workspaceId: null,
  homeShortcutReady: false,
};
export type SpeechEvent =
  | {
      method: "voice/partial" | "voice/final";
      text: string;
      language?: "en" | "fr";
    }
  | { method: "voice/speaking" | "voice/finished"; speechId: number }
  | { method: "voice/wake" | "voice/home" }
  | { method: "voice/shortcut"; text: string; language: "en" | "fr" }
  | { method: "voice/level"; level: number }
  | { method: "voice/error"; message: string };
export type Speech = {
  start: (standby?: boolean, homeOnly?: boolean) => Promise<void>;
  listen: () => Promise<void>;
  standby: () => Promise<void>;
  speak: (
    text: string,
    speechId: number,
    language: "en" | "fr",
  ) => Promise<void>;
  interrupt: () => Promise<void>;
  stop: () => void;
};
export type LiveMedia = {
  offer: () => Promise<string>;
  answer: (sdp: string) => Promise<void>;
  muteOutput: (muted: boolean) => Promise<void>;
  stop: () => void;
};
export type VoiceInput = {
  speech: (
    onEvent: (event: SpeechEvent) => void,
  ) => Pick<Speech, "start" | "stop">;
  media: (onEvent: (event: SpeechEvent) => void) => LiveMedia;
};
type Agent = Pick<
  CodexBackend,
  | "ensureAssistantWorkspace"
  | "startRealtimeVoice"
  | "stopRealtimeVoice"
  | "subscribeRealtime"
  | "speakRealtime"
  | "interrupt"
  | "snapshot"
  | "send"
>;
function isHomeShortcut(text: string) {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ");
  if (words[0] === "astra") words.shift();
  return words.length > 0 && words.every((word) => word === "home");
}
export class VoiceSession {
  private input: VoiceInput | null = null;
  private homeObservations: {
    kind: "recognition" | "reset" | "detected" | "navigated" | "failed";
    at: number;
    text?: string;
    language?: "en" | "fr";
  }[] = [];
  private state = structuredClone(INITIAL_VOICE);
  private wake: Pick<Speech, "start" | "stop"> | null = null;
  private homeListener: Pick<Speech, "start" | "stop"> | null = null;
  private localHomePending = false;
  private media: LiveMedia | null = null;
  private epoch = 0;
  private opening: Promise<void> | null = null;
  private closing = Promise.resolve();
  private idle: ReturnType<typeof setTimeout> | undefined;
  private pendingSdp: {
    resolve: (sdp: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private userStreaming = false;
  private assistantStreaming = false;
  private replyPrefix = "";
  private outputMuted = false;
  private wakeCommand = "";
  private wakeFinished: {
    promise: Promise<void>;
    resolve: () => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  constructor(
    private agent: Agent,
    private createWake: (
      onEvent: (event: SpeechEvent) => void,
    ) => Pick<Speech, "start" | "stop">,
    private createMedia: (onEvent: (event: SpeechEvent) => void) => LiveMedia,
    private publish: (state: VoiceState) => void,
    private navigateHome: () => Promise<unknown>,
  ) {
    agent.subscribeRealtime((message) => this.realtime(message));
  }

  snapshot() {
    return structuredClone(this.state);
  }
  shortcutDiagnostics() {
    return {
      ready: this.state.homeShortcutReady,
      error: this.state.error,
      observations: structuredClone(this.homeObservations),
    };
  }
  private observeHome(
    kind: (typeof this.homeObservations)[number]["kind"],
    text?: string,
    language?: "en" | "fr",
  ) {
    this.homeObservations.push({
      kind,
      at: Date.now(),
      ...(text === undefined
        ? {}
        : { text: text.slice(0, HOME_OBSERVATION_TEXT_LIMIT) }),
      ...(language ? { language } : {}),
    });
    this.homeObservations = this.homeObservations.slice(
      -HOME_OBSERVATION_LIMIT,
    );
  }
  private changed() {
    this.publish(this.snapshot());
  }
  private fail(error: unknown) {
    this.stop();
    this.state.status = "error";
    this.state.error = error instanceof Error ? error.message : String(error);
    this.changed();
  }
  private clearSdp(error: Error) {
    const pending = this.pendingSdp;
    this.pendingSdp = null;
    if (pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
  }
  private closeCall() {
    const homeListener = this.homeListener;
    this.homeListener = null;
    homeListener?.stop();
    this.state.homeShortcutReady = false;
    this.localHomePending = false;
    this.media?.stop();
    this.media = null;
    this.clearSdp(new Error("Astra voice stopped."));
    this.closing = this.closing.then(() => this.agent.stopRealtimeVoice());
    // Keep the chain usable; the caller receives the actual shutdown failure.
    const closing = this.closing;
    this.closing = closing.catch(() => {});
    return closing;
  }
  private armIdle() {
    clearTimeout(this.idle);
    const epoch = this.epoch;
    this.idle = setTimeout(() => {
      if (
        epoch === this.epoch &&
        this.state.active &&
        this.state.status === "listening"
      )
        void this.standby().catch((error) => this.fail(error));
    }, IDLE_TIMEOUT_MS);
    this.idle.unref?.();
  }
  private async standby() {
    const epoch = ++this.epoch;
    clearTimeout(this.idle);
    await this.closeCall();
    if (!this.state.active || this.epoch !== epoch) return;
    this.state.status = "standby";
    this.state.transcript = "";
    this.state.level = 0;
    this.changed();
    const wake = (this.input?.speech ?? this.createWake)((event) => {
      if (this.wake !== wake || !this.state.active) return;
      if (event.method === "voice/error") this.fail(event.message);
      else if (event.method === "voice/shortcut")
        this.observeHome(
          event.text ? "recognition" : "reset",
          event.text,
          event.language,
        );
      else if (event.method === "voice/home") {
        this.observeHome("detected");
        void this.home();
      } else if (event.method === "voice/wake") {
        this.wakeCommand = "";
        let resolve = () => {};
        const promise = new Promise<void>((done) => {
          resolve = done;
        });
        const timer = setTimeout(resolve, WAKE_COMMAND_TIMEOUT_MS);
        this.wakeFinished = { promise, resolve, timer };
        void this.start().catch((error) => this.fail(error));
      } else if (
        event.method === "voice/final" &&
        this.state.status === "starting"
      ) {
        this.wakeCommand = event.text.replace(/^astra\b[, .!?]*/i, "").trim();
        if (event.language) this.state.language = event.language;
        this.wakeFinished?.resolve();
      }
    });
    this.wake = wake;
    await wake.start(true);
    if (this.wake === wake && this.state.active) {
      this.state.homeShortcutReady = true;
      this.changed();
    }
    if (this.epoch !== epoch && this.snapshot().status !== "starting")
      wake.stop();
  }

  async start(standby = false, input?: VoiceInput | null) {
    if (input !== undefined && input !== this.input) {
      const previous = this.opening;
      this.stop();
      const transfer = this.epoch;
      if (previous) await previous.catch(() => {});
      if (this.epoch !== transfer) return;
      this.input = input;
    }
    if (this.opening) return this.opening;
    if (this.media && this.state.status !== "starting") {
      if (this.state.status === "speaking" || this.state.status === "thinking")
        await this.interrupt();
      return;
    }
    this.state = {
      ...INITIAL_VOICE,
      active: true,
      workspaceId: this.agent.ensureAssistantWorkspace(),
    };
    if (standby) {
      try {
        await this.standby();
      } catch (error) {
        if (!this.state.active) return;
        this.fail(error);
        throw error;
      }
      return;
    }
    this.state.status = "starting";
    this.changed();
    const epoch = ++this.epoch;
    const opening = this.connect(epoch);
    this.opening = opening;
    try {
      await opening;
    } catch (error) {
      if (this.epoch !== epoch && this.snapshot().status !== "error") return;
      if (this.epoch === epoch) this.fail(error);
      throw error;
    } finally {
      if (this.opening === opening) this.opening = null;
    }
  }

  private async connect(epoch: number) {
    await this.closing;
    if (epoch !== this.epoch) return;
    const media = (this.input?.media ?? this.createMedia)((event) => {
      if (this.media !== media || epoch !== this.epoch) return;
      if (event.method === "voice/error") this.fail(event.message);
      else if (event.method === "voice/level") {
        this.state.level = Math.max(0, Math.min(1, event.level));
        this.changed();
      }
    });
    this.media = media;
    const offer = await media.offer();
    if (epoch !== this.epoch) return;
    const sdp = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          this.clearSdp(
            new Error("GPT-Live did not answer. Start Astra again."),
          ),
        CONNECTION_TIMEOUT_MS,
      );
      this.pendingSdp = { resolve, reject, timer };
    });
    // Subscribe before starting: SDP arrives as a notification, independently of the request acknowledgement.
    const answer = Promise.all([
      sdp,
      this.agent.startRealtimeVoice(offer),
    ]).then(([value]) => value);
    const remoteSdp = await answer;
    if (epoch !== this.epoch) return;
    const wakeFinished = this.wakeFinished;
    if (wakeFinished) {
      await wakeFinished.promise;
      clearTimeout(wakeFinished.timer);
      if (this.wakeFinished === wakeFinished) this.wakeFinished = null;
    }
    if (epoch !== this.epoch) return;
    const wake = this.wake;
    this.wake = null;
    wake?.stop();
    await media.answer(remoteSdp);
    if (epoch !== this.epoch) return;
    this.state.status = "listening";
    this.state.error = null;
    this.userStreaming = false;
    this.assistantStreaming = false;
    this.outputMuted = false;
    this.armIdle();
    this.changed();
    void this.listenForHome(epoch);
    const command = this.wakeCommand;
    this.wakeCommand = "";
    if (isHomeShortcut(command)) await this.home();
    else if (command && this.state.workspaceId) {
      this.state.task = command;
      this.state.status = "thinking";
      this.changed();
      await this.agent.send(command, this.state.workspaceId);
    } else if (wakeFinished)
      await this.agent.speakRealtime(
        this.state.language === "fr" ? "Oui, je t’écoute." : "Yes, I’m here.",
      );
  }

  private async listenForHome(epoch: number) {
    const listener = (this.input?.speech ?? this.createWake)((event) => {
      if (
        this.homeListener !== listener ||
        !this.state.active ||
        epoch !== this.epoch
      )
        return;
      if (event.method === "voice/home") {
        this.observeHome("detected");
        this.localHomePending = true;
        void this.home();
      } else if (event.method === "voice/shortcut") {
        this.observeHome(
          event.text ? "recognition" : "reset",
          event.text,
          event.language,
        );
      } else if (event.method === "voice/error") {
        this.homeListener = null;
        listener.stop();
        this.state.homeShortcutReady = false;
        this.state.error = `Home shortcut unavailable: ${event.message}`;
        this.changed();
      }
    });
    this.homeListener = listener;
    try {
      await listener.start(true, true);
      if (
        this.homeListener !== listener ||
        !this.state.active ||
        epoch !== this.epoch
      ) {
        listener.stop();
        return;
      }
      this.state.homeShortcutReady = true;
      this.changed();
    } catch (error) {
      if (this.homeListener !== listener || epoch !== this.epoch) return;
      this.homeListener = null;
      listener.stop();
      this.state.homeShortcutReady = false;
      this.state.error = `Home shortcut unavailable: ${error instanceof Error ? error.message : String(error)}`;
      this.changed();
    }
  }

  async pause() {
    if (!this.state.active || this.state.status === "standby") return;
    try {
      await this.standby();
    } catch (error) {
      if (this.state.active) this.fail(error);
      throw error;
    }
  }

  stop() {
    const epoch = ++this.epoch;
    clearTimeout(this.idle);
    const wake = this.wake;
    this.wake = null;
    wake?.stop();
    this.state.active = false;
    this.state.status = "off";
    this.state.transcript = "";
    this.state.level = 0;
    this.wakeCommand = "";
    if (this.wakeFinished) {
      clearTimeout(this.wakeFinished.timer);
      this.wakeFinished.resolve();
      this.wakeFinished = null;
    }
    void this.closeCall().catch((error) => {
      if (this.epoch === epoch) {
        this.state.error = String(error);
        this.changed();
      }
    });
    this.changed();
  }
  async interrupt() {
    if (!this.state.active) return;
    this.outputMuted = true;
    await this.media?.muteOutput(true);
    if (this.state.workspaceId)
      await this.agent.interrupt(this.state.workspaceId);
    this.state.status = "listening";
    this.state.transcript = "";
    this.assistantStreaming = false;
    this.armIdle();
    this.changed();
  }

  private async home() {
    const epoch = this.epoch;
    this.outputMuted = Boolean(this.media);
    this.state.task = "Home";
    this.state.reply = "";
    this.state.transcript = "";
    this.assistantStreaming = false;
    try {
      await Promise.all([this.navigateHome(), this.media?.muteOutput(true)]);
      if (epoch !== this.epoch) return;
      this.observeHome("navigated");
      this.state.error = null;
      this.state.status = this.media ? "listening" : "standby";
      if (this.media) this.armIdle();
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.state.error = error instanceof Error ? error.message : String(error);
      this.observeHome("failed", this.state.error);
    }
    this.changed();
  }

  private realtime(message: RpcMessage) {
    if (!this.state.active || this.state.status === "standby") return;
    const params = message.params ?? {};
    if (
      message.method === "thread/realtime/sdp" &&
      typeof params.sdp === "string"
    ) {
      const pending = this.pendingSdp;
      this.pendingSdp = null;
      if (pending) {
        clearTimeout(pending.timer);
        pending.resolve(params.sdp);
      }
    } else if (message.method === "thread/realtime/error")
      this.fail(
        String(params.message ?? "GPT-Live stopped. Start Astra again."),
      );
    else if (message.method === "thread/realtime/closed" && this.media)
      this.fail(
        String(
          params.reason ?? "The voice connection closed. Start Astra again.",
        ),
      );
    else if (
      message.method === "thread/realtime/transcript/delta" &&
      typeof params.delta === "string"
    ) {
      if (params.role === "user") {
        if (!this.userStreaming) {
          this.state.transcript = "";
          this.state.reply = "";
          this.replyPrefix = "";
          this.userStreaming = true;
          this.assistantStreaming = false;
        }
        this.state.transcript += params.delta;
        this.state.status = "listening";
        if (
          this.outputMuted &&
          this.state.transcript.trim() &&
          (!this.localHomePending || !isHomeShortcut(this.state.transcript))
        ) {
          this.outputMuted = false;
          void this.media?.muteOutput(false).catch((error) => this.fail(error));
        }
      } else if (params.role === "assistant" && !this.outputMuted) {
        if (!this.assistantStreaming) {
          this.replyPrefix = this.state.reply
            ? `${this.state.reply.trimEnd()} `
            : "";
          this.state.reply = this.replyPrefix;
          this.assistantStreaming = true;
        }
        this.state.reply += params.delta;
        this.state.status = "speaking";
      }
      clearTimeout(this.idle);
      this.changed();
    } else if (
      message.method === "thread/realtime/transcript/done" &&
      typeof params.text === "string"
    ) {
      if (params.role === "user") {
        this.state.task = params.text;
        this.state.transcript = "";
        this.userStreaming = false;
        if (isHomeShortcut(params.text) && !this.localHomePending)
          void this.home();
        this.localHomePending = false;
      } else if (params.role === "assistant" && !this.outputMuted) {
        let prefix = this.replyPrefix;
        if (!this.assistantStreaming)
          prefix = this.state.reply ? `${this.state.reply.trimEnd()} ` : "";
        this.state.reply = `${prefix}${params.text}`;
        this.assistantStreaming = false;
        this.state.status =
          this.state.workspaceId &&
          this.agent.snapshot().sessions[this.state.workspaceId]?.busy
            ? "thinking"
            : "listening";
        if (this.state.status === "listening") this.armIdle();
      }
      this.changed();
    }
  }
  observe(snapshot: Snapshot) {
    if (
      !this.state.active ||
      !this.state.workspaceId ||
      this.state.status === "starting" ||
      this.state.status === "standby"
    )
      return;
    const session = snapshot.sessions[this.state.workspaceId];
    if (session?.busy && this.state.status === "listening") {
      this.state.status = "thinking";
      clearTimeout(this.idle);
      this.changed();
    }
    if (session?.error && session.error !== this.state.error) {
      this.state.error = session.error;
      this.changed();
    }
  }
}
