import { describe, expect, test } from "bun:test";
import { applySurfacePatch, emptySurface, SurfaceStream } from "../src/surface";

describe("live generated surfaces", () => {
  test("rejects renderer features outside the registered UI contract", () => {
    for (const extra of [
      { repeat: { statePath: "/items" } },
      { slots: { recursive: ["self"] } },
    ])
      expect(() =>
        applySurfacePatch(emptySurface(), {
          op: "add",
          path: "/elements/self",
          value: { type: "Stack", props: {}, ...extra },
        }),
      ).toThrow();
  });
  test("bounds expanded trees even when a small graph repeats children exponentially", () => {
    let spec = emptySurface();
    spec = applySurfacePatch(spec, {
      op: "add",
      path: "/elements/n0",
      value: { type: "Stack", props: {} },
    });
    expect(() => {
      for (let index = 1; index < 16; index++)
        spec = applySurfacePatch(spec, {
          op: "add",
          path: `/elements/n${index}`,
          value: {
            type: "Stack",
            props: {},
            children: [`n${index - 1}`, `n${index - 1}`],
          },
        });
    }).toThrow();
  });
  test("state bindings cannot traverse object prototypes", () => {
    expect(() =>
      applySurfacePatch(emptySurface(), {
        op: "add",
        path: "/elements/input",
        value: {
          type: "Input",
          props: { label: "Unsafe", statePath: "/__proto__/polluted" },
        },
      }),
    ).toThrow();
    expect(() =>
      applySurfacePatch(emptySurface(), {
        op: "add",
        path: "/elements/text",
        value: {
          type: "Text",
          props: { text: { $state: "/constructor/prototype" } },
        },
      }),
    ).toThrow();
  });
  test("renders complete patches before the model finishes", () => {
    let spec = emptySurface();
    let prose = "";
    const stream = new SurfaceStream(
      (patch) => {
        spec = applySurfacePatch(spec, patch);
      },
      (text) => {
        prose += text;
      },
    );
    stream.push(
      'Here is your view.\n```spec\n{"op":"add","path":"/root","value":"hello"}\n',
    );
    stream.push(
      '{"op":"add","path":"/elements/hello","value":{"type":"Heading","props":{"text":"Hello"}}}',
    );
    expect(spec.elements.hello).toBeUndefined();
    stream.push("\n");
    expect(spec.elements.hello.props.text).toBe("Hello");
    stream.push("```\n");
    stream.flush();
    expect(prose.trim()).toBe("Here is your view.");
  });

  test("patching layout preserves locally edited data", () => {
    const spec = emptySurface();
    spec.state = {
      tasks: [{ id: "1", title: "My own edit", status: "Doing" }],
    };
    const next = applySurfacePatch(spec, {
      op: "add",
      path: "/elements/title",
      value: { type: "Heading", props: { text: "New title" } },
    });
    expect(next.state).toEqual(spec.state);
    expect(spec.elements.title).toBeUndefined();
  });

  test("rejects unsafe paths, unknown components and cycles without losing the last valid UI", () => {
    const spec = emptySurface();
    for (const path of [
      "/__proto__/polluted",
      "/state/constructor/prototype/x",
      "/state/__proto__",
      "/outside",
    ]) {
      expect(() =>
        applySurfacePatch(spec, { op: "add", path, value: true }),
      ).toThrow();
    }
    expect(() =>
      applySurfacePatch(spec, {
        op: "add",
        path: "/elements/raw",
        value: { type: "Script", props: {} },
      }),
    ).toThrow();
    expect(() =>
      applySurfacePatch(spec, {
        op: "add",
        path: "/elements/loop",
        value: { type: "Stack", props: {}, children: ["loop"] },
      }),
    ).toThrow();
    expect(spec).toEqual(emptySurface());
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  test("rejects invalid component props and excessive data", () => {
    expect(() =>
      applySurfacePatch(emptySurface(), {
        op: "add",
        path: "/elements/board",
        value: { type: "Board", props: { columns: ["Todo"] } },
      }),
    ).toThrow();
    expect(() =>
      applySurfacePatch(emptySurface(), {
        op: "add",
        path: "/state/huge",
        value: "x".repeat(600_000),
      }),
    ).toThrow();
  });
});
