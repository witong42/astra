import {
  action,
  createLibrary,
  createParser,
  defineComponent,
  markReactive,
} from "@openuidev/lang-core";
import { z } from "zod";
import type { CanvasState } from "./canvas";
import { validateJson } from "./surface";

export const MAX_OPENUI_BYTES = 32 * 1024;
const MAX_STATEMENTS = 128;
const MAX_COMPONENTS = 200;
const MAX_NESTING = 16;
const scalar = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export const canvasInputsSchema = z.record(z.string().max(100), scalar);
export type CanvasInputs = z.infer<typeof canvasInputsSchema>;
export const openuiSchema = z
  .object({
    source: z.string().max(MAX_OPENUI_BYTES),
    state: z.record(z.string(), z.unknown()),
  })
  .strict();
const label = z.string().max(500);
const name = z.string().regex(/^[a-zA-Z][\w-]{0,63}$/);
function reactive<T extends z.ZodType>(schema: T): T {
  markReactive(schema);
  return schema;
}
const child: z.ZodType = z.lazy(() =>
  z.union(Object.values(uiComponents).map((component) => component.ref)),
);
const children = z.array(child).max(64);

export const uiComponents = {
  Stack: defineComponent({
    name: "Stack",
    description: "Vertical layout; the root of every program.",
    props: z.object({ children }),
    component: null,
  }),
  Grid: defineComponent({
    name: "Grid",
    description: "Responsive grid; collapses on small canvases.",
    props: z.object({
      children,
      columns: z.number().int().min(1).max(3).optional(),
    }),
    component: null,
  }),
  Card: defineComponent({
    name: "Card",
    description: "A titled section containing components.",
    props: z.object({ title: label, children }),
    component: null,
  }),
  Heading: defineComponent({
    name: "Heading",
    description: "Section heading.",
    props: z.object({ text: label }),
    component: null,
  }),
  Text: defineComponent({
    name: "Text",
    description: "Plain explanatory text, never HTML.",
    props: z.object({ text: z.string().max(4000) }),
    component: null,
  }),
  Metric: defineComponent({
    name: "Metric",
    description: "A labelled value and optional detail.",
    props: z.object({
      label,
      value: z.union([label, z.number()]),
      detail: label.optional(),
    }),
    component: null,
  }),
  Slider: defineComponent({
    name: "Slider",
    description: "Local numeric control; bind value to a $variable.",
    props: z.object({
      name,
      label,
      min: z.number(),
      max: z.number(),
      step: z.number().positive(),
      value: reactive(z.number()),
    }),
    component: null,
  }),
  Toggle: defineComponent({
    name: "Toggle",
    description: "Local on/off control; bind value to a $variable.",
    props: z.object({ name, label, value: reactive(z.boolean()) }),
    component: null,
  }),
  Select: defineComponent({
    name: "Select",
    description: "Local choice control; bind value to a $variable.",
    props: z.object({
      name,
      label,
      options: z.array(label).min(1).max(40),
      value: reactive(z.string()),
    }),
    component: null,
  }),
  Input: defineComponent({
    name: "Input",
    description: "Editable local notes or text; bind value to a $variable.",
    props: z.object({
      name,
      label,
      value: reactive(z.string()),
      multiline: z.boolean().optional(),
    }),
    component: null,
  }),
  Button: defineComponent({
    name: "Button",
    description:
      "An explicit action. Use @Set for local changes or @ToAssistant to ask Codex.",
    props: z.object({ label, action: action() }),
    component: null,
  }),
  AppleScriptButton: defineComponent({
    name: "AppleScriptButton",
    description:
      "Runs AppleScript directly on macOS without an assistant turn. Arguments are passed to on run argv; stdout or an error appears below the button.",
    props: z.object({
      label,
      script: z
        .string()
        .min(1)
        .max(64 * 1024),
      args: z.array(z.string().max(4000)).max(32).optional(),
    }),
    component: null,
  }),
  PowerShellButton: defineComponent({
    name: "PowerShellButton",
    description:
      "Runs PowerShell directly on Windows without an assistant turn. Arguments are passed as $args; stdout or an error appears below the button.",
    props: z.object({
      label,
      script: z
        .string()
        .min(1)
        .max(64 * 1024),
      args: z.array(z.string().max(4000)).max(32).optional(),
    }),
    component: null,
  }),
  ShellButton: defineComponent({
    name: "ShellButton",
    description:
      "Runs a POSIX shell script directly on Linux in the active mini-app directory. Arguments are passed as positional parameters; stdout or an error appears below the button.",
    props: z.object({
      label,
      script: z
        .string()
        .min(1)
        .max(64 * 1024),
      args: z.array(z.string().max(4000)).max(32).optional(),
    }),
    component: null,
  }),
  Table: defineComponent({
    name: "Table",
    description: "Table with text column headers and arrays of cell values.",
    props: z.object({
      columns: z.array(label).max(12),
      rows: z.array(z.array(scalar).max(12)).max(200),
    }),
    component: null,
  }),
  BarChart: defineComponent({
    name: "BarChart",
    description: "Labelled horizontal bars for numeric comparisons.",
    props: z.object({
      title: label,
      data: z
        .array(z.object({ label, value: z.number().nonnegative() }))
        .max(20),
    }),
    component: null,
  }),
  LiveCanvas: defineComponent({
    name: "LiveCanvas",
    description:
      "The workspace's sandboxed HTML/JS/Three.js canvas. At most one per program. Pass named $variables in inputs to drive it locally; height is 240-800 pixels. Populate its document using substrate operations.",
    props: z.object({
      inputs: canvasInputsSchema,
      height: z.number().int().min(240).max(800).optional(),
    }),
    component: null,
  }),
};
export const openuiCatalog = createLibrary({
  root: "Stack",
  components: Object.values(uiComponents),
});
const parser = createParser(openuiCatalog.toJSONSchema(), "Stack");

export function inspectOpenUI(source: string, complete = true) {
  if (new TextEncoder().encode(source).byteLength > MAX_OPENUI_BYTES)
    throw new Error("OpenUI exceeds its 32 KB limit. Simplify the layout.");
  const result = parser.parse(source);
  if (result.meta.statementCount > MAX_STATEMENTS)
    throw new Error("OpenUI has too many statements.");
  if (result.queryStatements.length || result.mutationStatements.length)
    throw new Error(
      "OpenUI data queries are unavailable. Use local values or ask Codex.",
    );
  const errors = result.meta.errors.filter(
    (error) => error.severity !== "warning",
  );
  if (errors.length)
    throw new Error(errors.map((error) => error.message).join(" "));
  if (
    complete &&
    (!result.root || result.meta.incomplete || result.meta.unresolved.length)
  )
    throw new Error(
      `OpenUI is incomplete. Check root and references: ${result.meta.unresolved.join(", ")}`,
    );
  let count = 0;
  let liveCanvases = 0;
  const visit = (value: unknown, depth: number) => {
    if (depth > MAX_NESTING) throw new Error("OpenUI is nested too deeply.");
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth);
      return;
    }
    const node = value as Record<string, unknown>;
    if (node.type === "element") {
      if (++count > MAX_COMPONENTS)
        throw new Error("OpenUI has too many components.");
      if (node.typeName === "LiveCanvas" && ++liveCanvases > 1)
        throw new Error("A workspace supports one LiveCanvas per layout.");
      visit(node.props, depth + 1);
    } else for (const item of Object.values(node)) visit(item, depth);
  };
  visit(result.root, 0);
  return { ...result, liveCanvases };
}

export function applyOpenUI(
  canvas: CanvasState,
  source: string,
  complete: boolean,
) {
  const result = inspectOpenUI(source, complete);
  // Keep the existing view until a streamed layout has resolved all references.
  if (!result.root || result.meta.unresolved.length || result.meta.incomplete)
    return;
  canvas.openui = { source, state: canvas.openui?.state ?? {} };
}
export function updateOpenUIState(
  canvas: CanvasState,
  generation: number,
  state: unknown,
) {
  if (!canvas.openui || canvas.generation !== generation)
    throw new Error("This layout changed before its controls could be saved.");
  canvas.openui.state = validateOpenUIState(state);
}
export function validateOpenUIState(state: unknown) {
  validateJson(state);
  const parsed = openuiSchema.shape.state.parse(state);
  if (
    new TextEncoder().encode(JSON.stringify(parsed)).byteLength >
    MAX_OPENUI_BYTES
  )
    throw new Error("OpenUI control data exceeds its 32 KB limit.");
  return parsed;
}
