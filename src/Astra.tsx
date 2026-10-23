import { StopIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { INITIAL_VOICE, type VoiceState } from "./voice";

export const VOICE_LABELS = {
  off: "Click to meet Astra",
  starting: "Preparing your voice…",
  standby: "Say Astra · Dites Astra",
  listening: "Listening · À votre écoute",
  thinking: "Working on it",
  speaking: "Speaking",
  error: "Try voice again",
};
const PARTICLE_COUNT = 1500;
const GALAXY_SIZE = 640;
function Galaxy({ voice }: { voice: VoiceState }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const current = useRef(voice);
  current.current = voice;
  useEffect(() => {
    const surface = canvas.current;
    const context = surface?.getContext("2d");
    if (!surface || !context) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const ratio = Math.min(devicePixelRatio, 2);
    surface.width = GALAXY_SIZE * ratio;
    surface.height = GALAXY_SIZE * ratio;
    context.scale(ratio, ratio);
    let frame = 0;
    let energy = 0;
    let seed = 73;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const stars = Array.from({ length: PARTICLE_COUNT }, (_, index) => ({
      radius: random() ** 0.62 * 237,
      angle: random() * Math.PI * 2,
      scatter: (random() - 0.5) * 0.8,
      size: 0.3 + random() * 0.85,
      alpha: 0.22 + random() * 0.7,
      arm: index % 3,
    }));
    const render = (time: number) => {
      const state = current.current;
      const speaking = state.status === "speaking";
      energy +=
        ((speaking ? 0.3 + Math.sin(time / 230) * 0.13 : state.level) -
          energy) *
        0.12;
      context.clearRect(0, 0, GALAXY_SIZE, GALAXY_SIZE);
      context.save();
      context.translate(GALAXY_SIZE / 2, GALAXY_SIZE / 2);
      const glow = context.createRadialGradient(0, 0, 0, 0, 0, 245);
      glow.addColorStop(0, `rgba(198,205,255,${0.19 + energy * 0.18})`);
      glow.addColorStop(0.19, "rgba(115,125,209,0.09)");
      glow.addColorStop(0.65, "rgba(83,69,143,0.025)");
      glow.addColorStop(1, "rgba(0,0,0,0)");
      context.fillStyle = glow;
      context.fillRect(-320, -320, 640, 640);
      context.rotate(-0.38);
      context.scale(1 + energy * 0.055, 0.63 + energy * 0.035);
      const rotation = reduced.matches
        ? 0
        : time / (state.status === "thinking" ? 34000 : 125000);
      for (const star of stars) {
        const angle =
          (star.arm * Math.PI * 2) / 3 +
          star.radius / 61 +
          star.scatter +
          rotation;
        const spread = Math.sin(star.angle) * (star.radius * 0.09 + 4);
        const x = Math.cos(angle) * star.radius + spread;
        const y = Math.sin(angle) * star.radius + Math.cos(star.angle) * spread;
        context.fillStyle = `rgba(${star.arm === 1 ? "171,182,245" : "220,228,255"},${star.alpha * (0.65 + energy * 0.35)})`;
        context.beginPath();
        context.arc(x, y, star.size * (1 + energy * 0.4), 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
      const center = GALAXY_SIZE / 2;
      const core = context.createRadialGradient(
        center,
        center,
        0,
        center,
        center,
        47 + energy * 20,
      );
      core.addColorStop(0, "rgba(255,255,255,0.95)");
      core.addColorStop(0.1, "rgba(231,235,255,0.85)");
      core.addColorStop(0.34, "rgba(178,190,250,0.17)");
      core.addColorStop(1, "rgba(120,130,220,0)");
      context.fillStyle = core;
      context.fillRect(center - 80, center - 80, 160, 160);
      if (!document.hidden && !reduced.matches)
        frame = requestAnimationFrame(render);
    };
    const resume = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(render);
    };
    document.addEventListener("visibilitychange", resume);
    reduced.addEventListener("change", resume);
    resume();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", resume);
      reduced.removeEventListener("change", resume);
    };
  }, []);
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
  onInterrupt,
  onPause,
}: {
  voice?: VoiceState;
  onToggle?: () => void;
  onInterrupt?: () => void;
  onPause?: () => void;
}) {
  const working = voice.status === "thinking" || voice.status === "speaking";
  const french = voice.language === "fr";
  return (
    <section
      className={`astra voice-${voice.status}`}
      aria-label="Astra voice assistant"
    >
      <h1 className="astra-name">ASTRA</h1>
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
      <p className="astra-state" role="status">
        <span className="astra-status-dot" />
        {VOICE_LABELS[voice.status]}
      </p>
      <div className="astra-conversation" aria-live="polite">
        <p className="astra-task">
          {voice.transcript ||
            voice.task ||
            (french
              ? "Que souhaitez-vous faire ?"
              : "What would you like to do?")}
        </p>
        {voice.reply && <p className="astra-result">{voice.reply}</p>}
        {voice.error && (
          <p className="astra-error" role="alert">
            {voice.error}
          </p>
        )}
      </div>
      <div className="astra-controls">
        {working && (
          <button
            type="button"
            onClick={onInterrupt}
            className="astra-interrupt"
          >
            <StopIcon size={12} weight="fill" />
            {french ? "Interrompre" : "Interrupt"}
            <kbd>esc</kbd>
          </button>
        )}
        {voice.active ? (
          <button type="button" onClick={onPause}>
            {french ? "Couper le micro" : "Pause microphone"}
          </button>
        ) : (
          <span>Français & English · Click once to enable voice</span>
        )}
      </div>
    </section>
  );
}
