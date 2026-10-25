import type { VoiceState } from "./voice";

const FRAME_INTERVAL_MS = 1000 / 30;
const MAX_PIXEL_RATIO = 2;
const LOGO_SCALE = 0.98;
const VOICE_SCALE = 0.035;
const ENERGY_EASING = 0.12;
const POINTER_EASING = 0.045;
const POINTER_TRAVEL = 0.04;
const ROTATION_PERIOD_MS = 8000;
const ROTATION_RANGE = 0.025;
const CORNER_RADIUS = 0.5;

export function mountLogo(
  surface: HTMLCanvasElement,
  readVoice: () => VoiceState,
) {
  const context = surface.getContext("2d");
  if (!context) throw new Error("Astra could not create its logo surface.");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const image = new Image();
  const parent = surface.parentElement ?? surface;
  let width = 0;
  let height = 0;
  let frame = 0;
  let lastFrame = 0;
  let ready = false;
  let disposed = false;
  let energy = 0;
  let pointerX = 0;
  let pointerY = 0;
  let targetX = 0;
  let targetY = 0;

  const draw = (time: number) => {
    if (!ready || !width || !height) return;
    const voice = readVoice();
    const resting = voice.status === "off" || voice.status === "standby";
    const moving = !reduced.matches && !resting;
    const level = Number.isFinite(voice.level)
      ? Math.max(0, Math.min(1, voice.level))
      : 0;
    const activity = moving ? level : 0;
    energy += (activity - energy) * ENERGY_EASING;
    pointerX += (targetX - pointerX) * POINTER_EASING;
    pointerY += (targetY - pointerY) * POINTER_EASING;
    const size =
      Math.min(width, height) * LOGO_SCALE * (1 + energy * VOICE_SCALE);
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(
      width / 2 + (reduced.matches ? 0 : pointerX * size * POINTER_TRAVEL),
      height / 2 + (reduced.matches ? 0 : pointerY * size * POINTER_TRAVEL),
    );
    context.rotate(
      moving ? Math.sin(time / ROTATION_PERIOD_MS) * ROTATION_RANGE : 0,
    );
    context.beginPath();
    context.roundRect(-size / 2, -size / 2, size, size, size * CORNER_RADIUS);
    context.clip();
    context.drawImage(image, -size / 2, -size / 2, size, size);
    context.restore();
  };
  const animate = (time: number) => {
    frame = 0;
    if (disposed || document.hidden) return;
    if (reduced.matches || time - lastFrame >= FRAME_INTERVAL_MS) {
      draw(time);
      lastFrame = time;
    }
    if (!reduced.matches) frame = requestAnimationFrame(animate);
  };
  const redraw = () => {
    if (!disposed && !frame && !document.hidden)
      frame = requestAnimationFrame(animate);
  };
  const resize = () => {
    const bounds = surface.getBoundingClientRect();
    width = bounds.width;
    height = bounds.height;
    const ratio = Math.min(devicePixelRatio || 1, MAX_PIXEL_RATIO);
    surface.width = Math.round(width * ratio);
    surface.height = Math.round(height * ratio);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    redraw();
  };
  const move = (event: PointerEvent) => {
    if (reduced.matches) return;
    const bounds = parent.getBoundingClientRect();
    targetX = (event.clientX - bounds.left) / bounds.width - 0.5;
    targetY = (event.clientY - bounds.top) / bounds.height - 0.5;
  };
  const leave = () => {
    targetX = targetY = 0;
  };
  const resume = () => {
    cancelAnimationFrame(frame);
    frame = 0;
    lastFrame = 0;
    redraw();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(surface);
  parent.addEventListener("pointermove", move);
  parent.addEventListener("pointerleave", leave);
  document.addEventListener("visibilitychange", resume);
  reduced.addEventListener("change", resume);
  image.onload = () => {
    ready = true;
    redraw();
  };
  image.onerror = () => {
    throw new Error("Astra's logo could not load. Rebuild the brand assets.");
  };
  image.src = "./astra-logo.svg";
  resize();
  return {
    redraw,
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      image.onload = image.onerror = null;
      parent.removeEventListener("pointermove", move);
      parent.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", resume);
      reduced.removeEventListener("change", resume);
    },
  };
}
