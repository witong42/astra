import type { VoiceState } from "./voice";

type Point = { x: number; y: number };
type Sample = Point & { distance: number };
const PATH_STEPS = 90;
const STAR_COUNT_PER_PATH = 650;
const DUST_START = 470;
const FRAME_INTERVAL_MS = 1000 / 30;
const MAX_PIXEL_RATIO = 2;
const HOME_FRAME_SIZE = 325;
const HOME_CENTER_Y = 162;
const COMPACT_FRAME_SIZE = 250;
const COMPACT_CENTER_Y = 210;
const COLORS = ["125,198,244", "225,241,252", "244,167,104"];
const TRAJECTORIES = [
  [
    [128, 2],
    [66, 24, 11, 93, 10, 162],
    [9, 249, 79, 263, 88, 263],
    [117, 263, 136, 244, 136, 221],
    [136, 190, 103, 194, 103, 209],
  ],
  [
    [225, 32],
    [132, 4, 30, 76, 30, 160],
    [30, 248, 98, 260, 126, 248],
  ],
  [
    [126, 215],
    [125, 223, 117, 237, 101, 236],
    [89, 236, 76, 220, 76, 196],
    [76, 166, 100, 143, 132, 143],
    [172, 143, 213, 171, 213, 231],
    [213, 276, 170, 328, 86, 317],
  ],
  [
    [107, 237],
    [82, 240, 61, 223, 61, 185],
    [61, 153, 92, 123, 132, 123],
    [173, 123, 228, 150, 228, 225],
    [228, 287, 168, 322, 121, 322],
    [53, 322, 11, 265, 2, 208],
  ],
  [
    [115, 211],
    [115, 226, 92, 227, 92, 205],
    [92, 184, 110, 175, 128, 175],
    [146, 175, 174, 196, 174, 231],
    [174, 264, 148, 282, 134, 287],
    [119, 293, 82, 297, 54, 269],
  ],
];
const TOP_BRANCH_SOURCE_SEGMENTS = 3;
const COMPACT_TOP_BRANCH_FOLDS = [
  [
    [227, 174],
    [211, 123.886662, 166, 92, 115, 92],
    [55, 92, -5.813346, 136.133789, 15.591376, 202.228488],
    [32.2236, 253.5864, 80.62, 263, 88, 263],
  ],
  [
    [213, 190],
    [204, 142.4447, 163, 110, 115, 110],
    [67, 110, 16.457736, 142.4447, 35.979744, 200.436064],
    [53.184, 251.5424, 103.04, 257.84, 126, 248],
  ],
];
const COMPACT_TRAJECTORIES = TRAJECTORIES.map((segments, index) => {
  const fold = COMPACT_TOP_BRANCH_FOLDS[index];
  return fold
    ? [...fold, ...segments.slice(TOP_BRANCH_SOURCE_SEGMENTS)]
    : segments;
});

function samplePaths(trajectories: number[][][]) {
  return trajectories.map((segments) => {
    let start = segments[0];
    let distance = 0;
    const points: Sample[] = [{ x: start[0], y: start[1], distance }];
    for (const segment of segments.slice(1)) {
      for (let step = 1; step <= PATH_STEPS; step++) {
        const t = step / PATH_STEPS;
        const u = 1 - t;
        const x =
          u ** 3 * start[0] +
          3 * u * u * t * segment[0] +
          3 * u * t * t * segment[2] +
          t ** 3 * segment[4];
        const y =
          u ** 3 * start[1] +
          3 * u * u * t * segment[1] +
          3 * u * t * t * segment[3] +
          t ** 3 * segment[5];
        const previous = points[points.length - 1];
        distance += Math.hypot(x - previous.x, y - previous.y);
        points.push({ x, y, distance });
      }
      start = segment.slice(-2);
    }
    return { points, distance };
  });
}
const paths = samplePaths(TRAJECTORIES);
const compactPaths = samplePaths(COMPACT_TRAJECTORIES);

export function galaxyPoint(index: number, progress: number, compact = false) {
  const path = (compact ? compactPaths : paths)[index];
  if (!path || !Number.isFinite(progress))
    throw new Error("Invalid galaxy path.");
  const target = Math.max(0, Math.min(1, progress)) * path.distance;
  let lo = 0;
  let hi = path.points.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (path.points[mid].distance < target) lo = mid;
    else hi = mid;
  }
  const a = path.points[lo];
  const b = path.points[hi];
  const f = (target - a.distance) / Math.max(0.001, b.distance - a.distance);
  return {
    x: a.x + (b.x - a.x) * f,
    y: a.y + (b.y - a.y) * f,
    dx: b.x - a.x,
    dy: b.y - a.y,
  };
}

function glowSprites() {
  return COLORS.map((color) => {
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 48;
    const context = sprite.getContext("2d");
    if (!context)
      throw new Error("The galaxy could not create its light surface.");
    const fill = context.createRadialGradient(24, 24, 0, 24, 24, 24);
    fill.addColorStop(0, "rgba(255,252,246,.95)");
    fill.addColorStop(0.06, "rgba(255,252,246,.9)");
    fill.addColorStop(0.18, `rgba(${color},.45)`);
    fill.addColorStop(0.4, `rgba(${color},.09)`);
    fill.addColorStop(1, `rgba(${color},0)`);
    context.fillStyle = fill;
    context.fillRect(0, 0, 48, 48);
    return sprite;
  });
}

export function mountGalaxy(
  surface: HTMLCanvasElement,
  readVoice: () => VoiceState,
  compact = false,
) {
  const context = surface.getContext("2d");
  if (!context) throw new Error("Astra could not create its galaxy surface.");
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const glows = glowSprites();
  const frameSize = compact ? COMPACT_FRAME_SIZE : HOME_FRAME_SIZE;
  const centerY = compact ? COMPACT_CENTER_Y : HOME_CENTER_Y;
  let seed = 7408;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const stars = paths.flatMap((_path, index) =>
    Array.from({ length: STAR_COUNT_PER_PATH }, (_, i) => {
      const progress = random();
      const bright = random() < (index % 2 === 0 ? 0.087 : 0.056);
      const dust = i > DUST_START;
      return {
        index,
        progress,
        offset: (random() + random() - 1) * (dust ? 14 : 6),
        depth: (random() - 0.5) * 5,
        radius: dust
          ? 0.22 + random() * 0.5
          : bright
            ? 1.05 + random() * 1.1
            : 0.24 + random() ** 1.8 * 0.85,
        alpha: dust ? 0.2 + random() * 0.4 : 0.55 + random() * 0.4,
        tone: random() < 0.14 ? 2 : random() < 0.58 ? 0 : 1,
        phase: random() * Math.PI * 2,
        bright: bright && !dust,
      };
    }),
  );
  const field = Array.from({ length: 100 }, () => ({
    x: random(),
    y: random(),
    radius: 0.22 + random() * 0.6,
    alpha: 0.08 + random() * 0.35,
  }));
  const cluster = Array.from({ length: 42 }, () => {
    const angle = random() * Math.PI * 2;
    const radius = random() ** 1.2 * 7;
    return {
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      radius: 0.4 + random() * 1.1,
    };
  });
  let width = 0;
  let height = 0;
  let frame = 0;
  let previousTime = 0;
  let lastFrame = 0;
  let travel = 0;
  let energy = 0;
  let pointerX = 0;
  let pointerY = 0;
  let targetX = 0;
  let targetY = 0;
  const parent = surface.parentElement ?? surface;
  const draw = (time: number) => {
    if (!width || !height) return;
    const voice = readVoice();
    const moving = !reduced.matches;
    const dt = Math.min(
      FRAME_INTERVAL_MS,
      previousTime ? time - previousTime : 0,
    );
    previousTime = time;
    if (moving)
      travel += dt * 0.000006 * (voice.status === "thinking" ? 1.6 : 1);
    const activity =
      voice.status === "speaking"
        ? 0.26 + Math.sin(time / 230) * 0.08
        : voice.level;
    energy = reduced.matches ? 0 : energy + (activity - energy) * 0.12;
    pointerX += (targetX - pointerX) * 0.045;
    pointerY += (targetY - pointerY) * 0.045;
    const scale =
      ((Math.min(width, height) * 0.94) / frameSize) * (1 + energy * 0.035);
    const project = (x: number, y: number, z = 0): Point => ({
      x:
        width * 0.5 +
        (x - 115) * scale * (1 - pointerX * 0.12) +
        z * pointerX * 12,
      y:
        height * 0.49 +
        (y - centerY) * scale * (1 + pointerY * 0.08) +
        z * pointerY * 7,
    });
    context.clearRect(0, 0, width, height);
    for (const star of field) {
      context.fillStyle = `rgba(139,190,221,${star.alpha})`;
      context.fillRect(
        star.x * width,
        star.y * height,
        star.radius,
        star.radius,
      );
    }
    const core = project(103, 209);
    const halo = context.createRadialGradient(
      core.x,
      core.y,
      0,
      core.x,
      core.y,
      scale * 43,
    );
    halo.addColorStop(0, `rgba(236,246,255,${0.24 + energy * 0.1})`);
    halo.addColorStop(0.14, "rgba(226,243,255,.16)");
    halo.addColorStop(0.4, "rgba(183,219,247,.065)");
    halo.addColorStop(1, "rgba(110,162,200,0)");
    context.fillStyle = halo;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = "lighter";
    for (const star of stars) {
      const progress =
        (star.progress + (star.index % 2 === 0 ? 1 : -1) * travel + 1) % 1;
      const point = galaxyPoint(star.index, progress, compact);
      const length = Math.hypot(point.dx, point.dy) || 1;
      const depth =
        Math.sin(progress * Math.PI * 2 + star.index * 0.8) * 0.6 +
        star.depth * 0.1;
      const position = project(
        point.x - (point.dy / length) * star.offset,
        point.y + (point.dx / length) * star.offset,
        depth,
      );
      const radius = Math.max(0.18, star.radius * scale * 0.84);
      const twinkle = moving
        ? 0.89 + 0.11 * Math.sin(time * 0.001 + star.phase)
        : 1;
      const alpha =
        star.alpha * twinkle * Math.min(1, progress * 35, (1 - progress) * 35);
      if (star.bright) {
        const glowRadius = radius * 6.5;
        context.globalAlpha = alpha * 0.72;
        context.drawImage(
          glows[star.tone],
          position.x - glowRadius,
          position.y - glowRadius,
          glowRadius * 2,
          glowRadius * 2,
        );
        context.globalAlpha = 1;
      }
      context.fillStyle = `rgba(${COLORS[star.tone]},${alpha})`;
      context.beginPath();
      context.arc(position.x, position.y, radius, 0, Math.PI * 2);
      context.fill();
      if (star.bright) {
        context.fillStyle = `rgba(249,252,255,${alpha * 0.85})`;
        context.beginPath();
        context.arc(position.x, position.y, radius * 0.52, 0, Math.PI * 2);
        context.fill();
      }
    }
    for (const star of cluster) {
      const position = project(103 + star.x, 209 + star.y);
      const radius = star.radius * scale;
      context.globalAlpha = 0.74;
      context.drawImage(
        glows[1],
        position.x - radius * 6,
        position.y - radius * 6,
        radius * 12,
        radius * 12,
      );
      context.globalAlpha = 1;
      context.fillStyle = "#f8fcff";
      context.beginPath();
      context.arc(position.x, position.y, radius * 0.6, 0, Math.PI * 2);
      context.fill();
    }
    context.globalCompositeOperation = "source-over";
  };
  const animate = (time: number) => {
    frame = 0;
    if (document.hidden) return;
    if (reduced.matches || time - lastFrame >= FRAME_INTERVAL_MS) {
      draw(time);
      lastFrame = time;
    }
    if (!reduced.matches) frame = requestAnimationFrame(animate);
  };
  const redraw = () => {
    if (!frame && !document.hidden) frame = requestAnimationFrame(animate);
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
    previousTime = 0;
    redraw();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(surface);
  parent.addEventListener("pointermove", move);
  parent.addEventListener("pointerleave", leave);
  document.addEventListener("visibilitychange", resume);
  reduced.addEventListener("change", resume);
  resize();
  return {
    redraw,
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      parent.removeEventListener("pointermove", move);
      parent.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", resume);
      reduced.removeEventListener("change", resume);
    },
  };
}
