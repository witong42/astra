import { expect, test } from "bun:test";
import {
  acknowledgeCanvas,
  beginCanvasGeneration,
  CanvasStream,
  emptyCanvas,
  queueCanvasOp,
  restoreCanvas,
} from "../src/canvas";

test("streamed Substrate patches survive reload until acknowledged and preserve local edits", () => {
  const canvas = emptyCanvas();
  beginCanvasGeneration(canvas);
  queueCanvasOp(canvas, {
    op: "replace",
    sel: "#substrate",
    html: '<main id="substrate"><input value="original"></main>',
  });
  expect(canvas.pending).toHaveLength(1);
  const restored = JSON.parse(JSON.stringify(canvas));
  acknowledgeCanvas(restored, {
    revision: 1,
    html: '<main id="substrate"><input value="my edit"></main>',
    css: "",
  });
  expect(restored.pending).toHaveLength(0);
  expect(restored.html).toContain("my edit");
  queueCanvasOp(restored, { op: "style", css: "main {color: green}" });
  acknowledgeCanvas(restored, { revision: 1, html: restored.html, css: "" });
  expect(restored.pending).toHaveLength(1);
  expect(() =>
    acknowledgeCanvas(restored, { revision: 10, html: "bad", css: "" }),
  ).toThrow();
  expect(() => restoreCanvas(restored)).toThrow();
});

test("restoring the previous canvas preserves the version it replaces", () => {
  const canvas = emptyCanvas();
  beginCanvasGeneration(canvas);
  queueCanvasOp(canvas, {
    op: "append",
    sel: "#substrate",
    html: "<h1>First</h1>",
  });
  acknowledgeCanvas(canvas, {
    revision: 1,
    html: '<main id="substrate"><h1>First</h1></main>',
    css: "",
  });
  beginCanvasGeneration(canvas);
  queueCanvasOp(canvas, { op: "style", css: "main {color:green}" });
  acknowledgeCanvas(canvas, {
    revision: 2,
    html: canvas.html,
    css: "main {color:green}",
  });
  restoreCanvas(canvas);
  expect(canvas.css).toBe("");
  expect(canvas.html).toContain("First");
  restoreCanvas(canvas);
  expect(canvas.css).toContain("green");
});

test("mixed conversation streams route fenced operations, notes and errors separately", () => {
  const ops: unknown[] = [];
  const text: string[] = [];
  const errors: string[] = [];
  const stream = new CanvasStream(
    (op) => ops.push(op),
    (line) => text.push(line),
    (error) => errors.push(error),
  );
  stream.push('Making a view.\n```substrate\n{"op":"append","sel":"#sub');
  expect(ops).toHaveLength(0);
  stream.push(
    'strate","html":"<h1>Hello</h1>"}\n{"op":"note","text":"Created a view."}\n{"op":"oops"}\n```\nReady.',
  );
  expect(ops).toHaveLength(1);
  stream.flush();
  expect(text.join("")).toContain("Created a view.");
  expect(text.join("")).toContain("Ready.");
  expect(errors).toHaveLength(1);
});

test("normal code examples remain in the conversation and runaway patch streams are bounded", () => {
  const ops: unknown[] = [];
  const text: string[] = [];
  const errors: string[] = [];
  const stream = new CanvasStream(
    (op) => ops.push(op),
    (line) => text.push(line),
    (error) => errors.push(error),
  );
  stream.push("Example:\n```ts\nconst x = 1;\n```\n");
  expect(text.join("")).toContain("const x = 1;");
  expect(errors).toHaveLength(0);
  stream.push(
    "```substrate\n" +
      Array(25).fill('{"op":"style","css":"main{color:green}"}').join("\n") +
      "\n```\n",
  );
  expect(ops).toHaveLength(24);
  expect(errors).toHaveLength(1);
});
