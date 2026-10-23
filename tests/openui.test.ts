import { expect, test } from "bun:test";
import {
  beginCanvasGeneration,
  CanvasStream,
  emptyCanvas,
  restoreCanvas,
  validateCanvas,
} from "../src/canvas";
import { applyOpenUI, updateOpenUIState } from "../src/openui";

const source =
  'root = Stack([title, speed, scene])\n$speed = 1\ntitle = Heading("Orbit lab")\nspeed = Slider("speed", "Speed", 0, 3, 0.1, $speed)\nscene = LiveCanvas({speed: $speed}, 360)';

test("OpenUI streams separately from prose and Substrate operations", () => {
  const layouts: { source: string; complete: boolean }[] = [];
  const text: string[] = [];
  const ops: unknown[] = [];
  const errors: string[] = [];
  const stream = new CanvasStream(
    (op) => ops.push(op),
    (line) => text.push(line),
    (error) => errors.push(error),
    (source, complete) => layouts.push({ source, complete }),
  );
  stream.push("Making a lab.\n```openui\nroot = Stack([title])\ntit");
  stream.push(
    'le = Heading("Orbit lab")\n```\n```substrate\n{"op":"append","sel":"#substrate","html":"<div>Scene</div>"}\n```\nReady.',
  );
  stream.flush();
  expect(layouts.at(-1)).toEqual({
    source: 'root = Stack([title])\ntitle = Heading("Orbit lab")\n',
    complete: true,
  });
  expect(layouts[0].complete).toBe(false);
  expect(text.join("")).toContain("Making a lab.");
  expect(text.join("")).not.toContain("root =");
  expect(ops).toHaveLength(1);
  expect(errors).toEqual([]);
});

test("hybrid source and edited reactive state survive saving and version restore", () => {
  const canvas = emptyCanvas();
  canvas.html =
    '<main id="substrate"><div id="scene">Keep the scene</div></main>';
  beginCanvasGeneration(canvas);
  applyOpenUI(canvas, source, true);
  updateOpenUIState(canvas, canvas.generation, { $speed: 2.4 });
  const restored = validateCanvas(JSON.parse(JSON.stringify(canvas)));
  expect(restored.openui?.state).toEqual({ $speed: 2.4 });
  expect(restored.html).toContain("Keep the scene");
  beginCanvasGeneration(restored);
  applyOpenUI(restored, 'root = Stack([Heading("Second")])', true);
  restoreCanvas(restored);
  expect(restored.openui?.source).toBe(source);
  expect(restored.openui?.state).toEqual({ $speed: 2.4 });
  restoreCanvas(restored);
  expect(restored.openui?.source).toContain("Second");
});

test("invalid or oversized programs keep the last working layout", () => {
  const canvas = emptyCanvas();
  applyOpenUI(canvas, source, true);
  const before = structuredClone(canvas);
  for (const input of [
    'root = Unknown("bad")',
    "root = Stack([missing])",
    "root = Stack([LiveCanvas({}), LiveCanvas({})])",
    'root = Stack([Query("secret", {})])',
    "x".repeat(40_000),
  ]) {
    expect(() => applyOpenUI(canvas, input, true)).toThrow();
    expect(canvas).toEqual(before);
  }
  applyOpenUI(canvas, "root = Stack([title])\n", false);
  expect(canvas).toEqual(before);
});

test("state updates reject stale generations, non-JSON and unsafe keys", () => {
  const canvas = emptyCanvas();
  applyOpenUI(canvas, source, true);
  expect(() =>
    updateOpenUIState(canvas, canvas.generation + 1, { $speed: 3 }),
  ).toThrow();
  expect(() =>
    updateOpenUIState(canvas, canvas.generation, { x: NaN }),
  ).toThrow();
  expect(() =>
    updateOpenUIState(
      canvas,
      canvas.generation,
      JSON.parse('{"__proto__":{"polluted":true}}'),
    ),
  ).toThrow();
  expect(canvas.openui?.state).toEqual({});
});

test("unfinished OpenUI fences finish on turn completion and oversized fences do not leak code into chat", () => {
  const updates: unknown[] = [];
  const errors: string[] = [];
  const text: string[] = [];
  const stream = new CanvasStream(
    () => {},
    (line) => text.push(line),
    (error) => errors.push(error),
    (source, complete) => updates.push({ source, complete }),
  );
  stream.push('```openui\nroot = Stack([Heading("Small")])');
  stream.flush();
  expect(updates.at(-1)).toEqual({
    source: 'root = Stack([Heading("Small")])\n',
    complete: true,
  });
  const huge = new CanvasStream(
    () => {},
    (line) => text.push(line),
    (error) => errors.push(error),
    () => {},
  );
  huge.push(
    "```openui\n" +
      "x".repeat(33_000) +
      '\nprivate = "never in chat"\n```\nFinished.\n',
  );
  expect(errors).toHaveLength(1);
  expect(text.join("")).toBe("Finished.\n");
});
