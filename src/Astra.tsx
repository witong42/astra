import { type CSSProperties, useEffect, useRef } from "react";
import { mountLogo } from "./brand-avatar";
import { mountGalaxy } from "./galaxy";
import { useLocale } from "./LocaleProvider";
import { INITIAL_VOICE, type VoiceState } from "./voice";

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
  const scene = useRef<ReturnType<typeof mountLogo> | null>(null);
  useEffect(() => {
    const surface = canvas.current;
    if (!surface) return;
    scene.current = compact
      ? mountLogo(surface, () => current.current)
      : mountGalaxy(surface, () => current.current);
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
  const { language, t } = useLocale();
  const label = t.voiceStates[voice.status];
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
        aria-label={t.returnHome}
        aria-description={label}
        title={`Astra · ${label}`}
      >
        <Galaxy voice={{ ...voice, level }} compact />
      </button>
    );
  }
  const resting = voice.status === "off" || voice.status === "standby";
  const conversing = voice.active && !resting;
  const spokenText =
    !resting && (voice.transcript || voice.reply || voice.task);
  const text = spokenText || (resting ? t.here : t.listening);
  return (
    <section
      className={`astra voice-${voice.status}`}
      aria-label={t.astraVoice}
    >
      <button
        type="button"
        className="astra-avatar"
        aria-label={
          conversing ? t.pauseAstra : voice.active ? t.talkAstra : t.startVoice
        }
        aria-pressed={conversing}
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
        <p className="astra-task" lang={spokenText ? voice.language : language}>
          {text}
        </p>
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
