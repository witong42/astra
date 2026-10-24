import { type CSSProperties, useEffect, useRef } from "react";
import { mountGalaxy } from "./galaxy";
import { INITIAL_VOICE, type VoiceState } from "./voice";

const VOICE_LABELS = {
  fr: {
    off: "Micro désactivé",
    starting: "Connexion vocale",
    standby: "En veille",
    listening: "À ton écoute",
    thinking: "Je m’en occupe",
    speaking: "Astra répond",
    error: "Voix indisponible",
  },
  en: {
    off: "Microphone off",
    starting: "Connecting voice",
    standby: "On standby",
    listening: "Listening",
    thinking: "Working on it",
    speaking: "Speaking",
    error: "Voice unavailable",
  },
};
function Galaxy({
  voice,
  compact = false,
}: {
  voice: VoiceState;
  compact?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef(voice);
  current.current = voice;
  const scene = useRef<ReturnType<typeof mountGalaxy> | null>(null);
  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    scene.current = mountGalaxy(surface, () => current.current, compact);
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, [compact]);
  useEffect(() => scene.current?.redraw());
  return (
    <canvas
      ref={canvas}
      className="astra-galaxy"
      aria-hidden="true"
      tabIndex={-1}
    />
  );
}

export function Astra({
  voice = INITIAL_VOICE,
  onToggle,
  compact = false,
}: {
  voice?: VoiceState;
  onToggle?: () => void;
  compact?: boolean;
}) {
  const french = voice.language === "fr";
  const label = VOICE_LABELS[voice.language][voice.status];
  if (compact) {
    const level =
      (voice.status === "listening" || voice.status === "speaking") &&
      Number.isFinite(voice.level)
        ? Math.max(0, Math.min(1, voice.level))
        : 0;
    return (
      <button
        type="button"
        className={`astra-home-orb home-button voice-${voice.status}`}
        style={{ "--astra-voice-level": level } as CSSProperties}
        onClick={onToggle}
        aria-label="Retour à l’accueil"
        aria-description={label}
        title={`Astra · ${label}`}
      >
        <Galaxy voice={{ ...voice, level }} compact />
      </button>
    );
  }
  const resting = voice.status === "off" || voice.status === "standby";
  const text = resting
    ? french
      ? "Je suis là."
      : "I’m here."
    : voice.transcript ||
      voice.reply ||
      voice.task ||
      (french ? "Je t’écoute…" : "I’m listening…");
  return (
    <section
      className={`astra voice-${voice.status}`}
      lang={voice.language}
      aria-label="Astra voice assistant"
    >
      <button
        type="button"
        className="astra-avatar"
        aria-label={voice.active ? "Talk to Astra" : "Start Astra voice"}
        aria-pressed={voice.active}
        disabled={voice.status === "starting"}
        onClick={onToggle}
      >
        <Galaxy voice={voice} />
      </button>
      <div className="astra-conversation">
        <div className="astra-signal" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
          <span />
        </div>
        <p className="astra-task">{text}</p>
        <p className="astra-state" role="status">
          {label}
        </p>
        {voice.error && (
          <p className="astra-error" role="alert">
            {voice.error}
          </p>
        )}
      </div>
    </section>
  );
}
