import { expect, test } from "bun:test";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { renderToStaticMarkup } from "react-dom/server";
import { registry } from "../src/registry";
import { validateSurface } from "../src/surface";

test("the component catalog renders data-bound controls and escapes generated content", () => {
  const spec = validateSurface({
    root: "root",
    elements: {
      root: {
        type: "Stack",
        props: {},
        children: [
          "heading",
          "text",
          "grid",
          "board",
          "table",
          "chart",
          "input",
          "checkbox",
          "select",
          "button",
          "divider",
        ],
      },
      heading: { type: "Heading", props: { text: "A useful workspace" } },
      text: {
        type: "Text",
        props: { text: '<img src="x" onerror="alert(1)">' },
      },
      grid: { type: "Grid", props: { columns: 2 }, children: ["card"] },
      card: { type: "Card", props: { title: "Summary" }, children: ["metric"] },
      metric: { type: "Metric", props: { label: "Tasks", value: "2" } },
      board: {
        type: "Board",
        props: { statePath: "/tasks", columns: ["To do", "Done"] },
      },
      table: {
        type: "Table",
        props: {
          statePath: "/tasks",
          columns: [{ key: "title", label: "Task" }],
        },
      },
      chart: { type: "Chart", props: { statePath: "/series" } },
      input: { type: "Input", props: { label: "Notes", statePath: "/notes" } },
      checkbox: {
        type: "Checkbox",
        props: { label: "Ready", statePath: "/ready" },
      },
      select: {
        type: "Select",
        props: {
          label: "Priority",
          statePath: "/priority",
          options: ["High", "Low"],
        },
      },
      button: {
        type: "Button",
        props: { label: "Ask Codex", prompt: "Update my plan" },
      },
      divider: { type: "Divider", props: {} },
    },
    state: {
      notes: "Retained note",
      ready: true,
      priority: "High",
      tasks: [{ id: "1", title: "My task", status: "To do" }],
      series: [{ label: "Done", value: 2 }],
    },
  });
  const html = renderToStaticMarkup(
    <JSONUIProvider registry={registry} initialState={spec.state}>
      <Renderer spec={spec} registry={registry} />
    </JSONUIProvider>,
  );
  expect(html).toContain("My task");
  expect(html).toContain("Retained note");
  expect(html).toContain("&lt;img");
  expect(html).not.toContain('<img src="x"');
});
