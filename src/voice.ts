import type { CodexBackend } from "./backend";
import type { Snapshot } from "./types";

const MAX_SPOKEN_LENGTH = 1800;
const FOLLOW_UP_WINDOW_MS = 20_000;
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
};
export const INITIAL_VOICE: VoiceState = {
  active: false,
  status: "off",
  language: "en",
  transcript: "",
  task: "",
  reply: "",
  level: 0,
  error: null,
  workspaceId: null,
};
export type SpeechEvent =
  | {
      method: "voice/partial" | "voice/final";
      text: string;
      language?: "en" | "fr";
    }
  | { method: "voice/speaking" | "voice/finished"; speechId: number }
  | { method: "voice/wake" }
  | { method: "voice/level"; level: number }
  | { method: "voice/error"; message: string };
export type Speech = {
  start: (standby?: boolean) => Promise<void>;
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
export function spokenReply(text: string) {
  return text
    .replace(/```[\s\S]*?(?:```|$)/g, "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[#*_`>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SPOKEN_LENGTH);
}
type Agent = Pick<
  CodexBackend,
  "ensureAssistantWorkspace" | "send" | "interrupt" | "snapshot" | "answer"
>;
export class VoiceSession {
  private state = structuredClone(INITIAL_VOICE);
  private speech: Speech | null = null;
  private epoch = 0;
  private speechId = 0;
  private awaitingReply = false;
  private wasWorking = false;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private prompted: string | number | null = null;
  private replyIds = new Set<string>();
  constructor(
    private agent: Agent,
    private createSpeech: (onEvent: (event: SpeechEvent) => void) => Speech,
    private publish: (state: VoiceState) => void,
  ) {}
  snapshot() {
    return structuredClone(this.state);
  }
  private changed() {
    this.publish(this.snapshot());
  }
  private fail(error: unknown) {
    this.epoch++;
    clearTimeout(this.idle);
    this.speech?.stop();
    this.speech = null;
    this.awaitingReply = false;
    this.state.active = false;
    this.state.status = "error";
    this.state.level = 0;
    this.state.error = error instanceof Error ? error.message : String(error);
    this.changed();
  }
  private waitForFollowUp() {
    clearTimeout(this.idle);
    const epoch = this.epoch;
    this.idle = setTimeout(() => {
      if (
        epoch !== this.epoch ||
        !this.state.active ||
        this.awaitingReply ||
        this.state.status !== "listening"
      )
        return;
      this.state.status = "standby";
      this.state.transcript = "";
      this.changed();
      this.speech?.standby().catch((error) => {
        if (epoch === this.epoch) this.fail(error);
      });
    }, FOLLOW_UP_WINDOW_MS);
    this.idle.unref?.();
  }
  async start(standby = false) {
    if (this.state.active) {
      if (this.state.status === "starting") return;
      if (this.state.status === "thinking" || this.state.status === "speaking")
        await this.interrupt();
      await this.speech?.listen();
      this.state.status = "listening";
      this.waitForFollowUp();
      this.changed();
      return;
    }
    const epoch = ++this.epoch;
    this.state = {
      ...INITIAL_VOICE,
      active: true,
      status: "starting",
      workspaceId: this.agent.ensureAssistantWorkspace(),
    };
    this.changed();
    this.speech = this.createSpeech((event) => {
      if (this.epoch === epoch && this.state.active) this.handle(event);
    });
    try {
      await this.speech.start(standby);
      if (this.epoch !== epoch) return;
      this.state.status = standby ? "standby" : "listening";
      if (!standby) this.waitForFollowUp();
      this.changed();
    } catch (error) {
      if (this.epoch !== epoch) return;
      this.fail(error);
      throw error;
    }
  }
  stop() {
    this.epoch++;
    clearTimeout(this.idle);
    this.speech?.stop();
    this.speech = null;
    this.awaitingReply = false;
    this.state.active = false;
    this.state.status = "off";
    this.state.transcript = "";
    this.state.level = 0;
    this.changed();
  }
  async interrupt() {
    const epoch = this.epoch;
    this.speechId++;
    this.awaitingReply = false;
    await this.speech?.interrupt();
    if (this.state.workspaceId)
      await this.agent.interrupt(this.state.workspaceId);
    if (epoch !== this.epoch) return;
    this.state.status = this.state.active ? "listening" : "off";
    this.state.transcript = "";
    this.waitForFollowUp();
    this.changed();
  }
  private handle(event: SpeechEvent) {
    if (event.method === "voice/error") return this.fail(event.message);
    if (event.method === "voice/level")
      this.state.level = Math.max(0, Math.min(1, event.level));
    else if (event.method === "voice/wake") {
      this.state.status = "listening";
      this.state.transcript = "";
      this.waitForFollowUp();
    } else if (event.method === "voice/partial") {
      if (this.state.status === "standby") return;
      this.state.transcript = event.text;
      if (event.language) this.state.language = event.language;
      if (this.state.status === "speaking") {
        this.speechId++;
        this.speech?.interrupt().catch((error) => this.fail(error));
        this.state.status = "listening";
      }
      this.waitForFollowUp();
    } else if (event.method === "voice/final") {
      if (this.state.status === "standby") return;
      if (event.language) this.state.language = event.language;
      const epoch = this.epoch;
      void this.submit(event.text).catch((error) => {
        if (epoch === this.epoch) this.fail(error);
      });
      return;
    } else if ("speechId" in event && event.speechId === this.speechId) {
      this.state.status =
        event.method === "voice/speaking" ? "speaking" : "listening";
      if (event.method === "voice/finished") this.waitForFollowUp();
    }
    this.changed();
  }
  private speak(text: string) {
    this.state.reply = text;
    this.state.status = text ? "speaking" : "listening";
    this.changed();
    if (text) {
      const epoch = this.epoch;
      this.speech
        ?.speak(text, ++this.speechId, this.state.language)
        .catch((error) => {
          if (epoch === this.epoch) this.fail(error);
        });
    } else this.waitForFollowUp();
  }
  async submit(text: string) {
    if (!this.state.active || !this.state.workspaceId) return;
    const value = text.replace(/^astra\b[, .!?]*/i, "").trim();
    if (!value) {
      this.waitForFollowUp();
      return;
    }
    if (
      /^(?:stop|cancel|be quiet|stop talking|arrête|arrete|annule|silence|tais.toi)[.!?]*$/i.test(
        value,
      )
    )
      return this.interrupt();
    clearTimeout(this.idle);
    const epoch = this.epoch;
    this.speechId++;
    await this.speech?.interrupt();
    if (epoch !== this.epoch) return;
    const snapshot = this.agent.snapshot();
    const approval = snapshot.sessions[this.state.workspaceId]?.approval;
    if (approval) {
      if (approval.kind === "question" && approval.questions?.length === 1) {
        this.agent.answer(
          true,
          { [approval.questions[0].id]: value },
          this.state.workspaceId,
          approval.id,
        );
      } else if (
        /^(?:yes|oui|approve|approuve|allow|autorise|no|non|deny|refuse)[.!?]*$/i.test(
          value,
        ) &&
        approval.kind !== "question"
      ) {
        this.agent.answer(
          !/^(?:no|non|deny|refuse)/i.test(value),
          undefined,
          this.state.workspaceId,
          approval.id,
        );
      } else {
        this.speak(
          this.state.language === "fr"
            ? "J’ai besoin de votre réponse dans Astra pour continuer."
            : "Please answer the question in Astra so I can continue.",
        );
        return;
      }
      this.state.status = "thinking";
      this.changed();
      return;
    }
    if (!this.awaitingReply || !snapshot.sessions[this.state.workspaceId]?.busy)
      this.replyIds = new Set(
        snapshot.assistant?.messages.map((message) => message.id),
      );
    this.state.task = value;
    this.state.transcript = "";
    this.state.reply = "";
    this.state.error = null;
    this.state.status = "thinking";
    this.awaitingReply = true;
    this.wasWorking = false;
    this.prompted = null;
    this.changed();
    await this.agent.send(value, this.state.workspaceId);
  }
  observe(snapshot: Snapshot) {
    if (!this.state.active || !this.state.workspaceId || !this.awaitingReply)
      return;
    const session = snapshot.sessions[this.state.workspaceId];
    if (session?.approval && session.approval.id !== this.prompted) {
      this.prompted = session.approval.id;
      this.speak(
        spokenReply(
          session.approval.questions
            ?.map((question) => question.question)
            .join(" ") || session.approval.summary,
        ),
      );
      return;
    }
    if (session?.busy) {
      this.wasWorking = true;
      if (session.approval || this.state.status === "speaking") return;
      if (this.state.status !== "thinking") {
        this.state.status = "thinking";
        this.changed();
      }
      return;
    }
    if (!this.wasWorking) return;
    this.awaitingReply = false;
    const reply = snapshot.assistant?.messages
      .slice()
      .reverse()
      .find(
        (message) =>
          message.role === "assistant" &&
          message.text.trim() &&
          !this.replyIds.has(message.id),
      );
    const error =
      session?.error ||
      (snapshot.status === "offline"
        ? "The connection to Codex stopped."
        : null);
    this.state.error = error;
    const fallback =
      this.state.language === "fr"
        ? "La demande est terminée."
        : "The request finished.";
    this.speak(
      error
        ? this.state.language === "fr"
          ? `Je n’ai pas pu terminer. ${error}`
          : `I couldn't finish that request. ${error}`
        : spokenReply(reply?.text ?? fallback),
    );
  }
}
