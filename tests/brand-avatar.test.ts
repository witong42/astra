import { expect, test } from "bun:test";
import { runInNewContext } from "node:vm";

async function logoFixture(reducedMotion = true) {
  const source = await Bun.file(
    new URL("../src/brand-avatar.ts", import.meta.url),
  ).text();
  const script = new Bun.Transpiler({ loader: "ts" })
    .transformSync(source)
    .replace(/export function /g, "function ");
  const scheduled = new Map<number, (time: number) => void>();
  const observers: (() => void)[] = [];
  const listeners = new Map<string, () => void>();
  const images: {
    onload: (() => void) | null;
    onerror: (() => void) | null;
    src: string;
  }[] = [];
  const draws: unknown[][] = [];
  let nextFrame = 0;
  let paints = 0;
  let disconnected = false;
  const context = new Proxy(
    {
      clearRect: () => paints++,
      drawImage: (...args: unknown[]) => draws.push(args),
    },
    { get: (target, key) => Reflect.get(target, key) ?? (() => {}) },
  );
  const events = {
    addEventListener(name: string, callback: () => void) {
      listeners.set(name, callback);
    },
    removeEventListener(name: string) {
      listeners.delete(name);
    },
  };
  const canvas = {
    ...events,
    width: 0,
    height: 0,
    getContext: () => context,
    getBoundingClientRect: () => ({ width: 744, height: 620 }),
  };
  const document = { hidden: false, ...events };
  const media = { matches: reducedMotion, ...events };
  const { mountLogo } = runInNewContext(`${script};({mountLogo})`, {
    document,
    Image: class {
      onload = null;
      onerror = null;
      src = "";
      constructor() {
        images.push(this);
      }
    },
    devicePixelRatio: 3,
    matchMedia: () => media,
    requestAnimationFrame: (callback: (time: number) => void) => {
      scheduled.set(++nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame: (id: number) => scheduled.delete(id),
    ResizeObserver: class {
      constructor(callback: () => void) {
        observers.push(callback);
      }
      observe() {}
      disconnect() {
        disconnected = true;
      }
    },
  }) as {
    mountLogo: (...args: unknown[]) => {
      redraw: () => void;
      dispose: () => void;
    };
  };
  const voice = { status: "standby", level: 0 };
  const scene = mountLogo(canvas, () => voice);
  const paint = (time: number) => {
    const entry = scheduled.entries().next().value;
    if (!entry) throw new Error("No logo frame was scheduled.");
    scheduled.delete(entry[0]);
    entry[1](time);
  };
  return {
    scene,
    images,
    observers,
    scheduled,
    draws,
    canvas,
    document,
    media,
    voice,
    listeners,
    paint,
    get paints() {
      return paints;
    },
    get disconnected() {
      return disconnected;
    },
  };
}

test("the logo badge loads the approved artwork and redraws after loading with reduced motion", async () => {
  const fixture = await logoFixture(true);
  try {
    expect(fixture.images[0].src).toBe("./astra-logo.svg");
    fixture.paint(16);
    expect(fixture.paints).toBe(0);
    fixture.images[0].onload?.();
    fixture.paint(20);
    expect(fixture.paints).toBe(1);
    expect(fixture.draws[0][0]).toBe(fixture.images[0]);
    expect(fixture.scheduled.size).toBe(0);
    fixture.observers[0]();
    fixture.paint(30);
    expect(fixture.paints).toBe(2);
    expect(fixture.scheduled.size).toBe(0);
    expect(fixture.canvas.width).toBe(1488);
    expect(fixture.canvas.height).toBe(1240);
  } finally {
    fixture.scene.dispose();
  }
});

test("hidden and disposed logos stop painting and release their resources", async () => {
  const fixture = await logoFixture(false);
  fixture.images[0].onload?.();
  fixture.paint(40);
  expect(fixture.scheduled.size).toBe(1);
  fixture.document.hidden = true;
  fixture.paint(80);
  expect(fixture.scheduled.size).toBe(0);
  fixture.document.hidden = false;
  fixture.listeners.get("visibilitychange")?.();
  expect(fixture.scheduled.size).toBe(1);
  fixture.scene.dispose();
  fixture.scene.redraw();
  expect(fixture.scheduled.size).toBe(0);
  expect(fixture.disconnected).toBe(true);
  expect(fixture.listeners.size).toBe(0);
  expect(fixture.images[0].onload).toBeNull();
  expect(fixture.images[0].onerror).toBeNull();
});

test("invalid voice levels cannot distort the logo and failed loads are actionable", async () => {
  const fixture = await logoFixture(false);
  try {
    fixture.voice.status = "speaking";
    fixture.voice.level = Number.NaN;
    fixture.images[0].onload?.();
    fixture.paint(40);
    expect(fixture.draws[0].slice(1).every(Number.isFinite)).toBe(true);
    expect(() => fixture.images[0].onerror?.()).toThrow(
      "Rebuild the brand assets",
    );
  } finally {
    fixture.scene.dispose();
  }
});
