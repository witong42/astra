import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

const label = z.string().max(2_000);
const statePath = z
  .string()
  .regex(/^\/[A-Za-z0-9_~/-]+$/)
  .max(300);
const title = label.optional();

export const catalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: z.object({
        direction: z.enum(["vertical", "horizontal"]).optional(),
        gap: z.enum(["small", "medium", "large"]).optional(),
      }),
      slots: ["default"],
      description: "Flexible layout container; vertical by default.",
    },
    Grid: {
      props: z.object({ columns: z.number().int().min(1).max(4).optional() }),
      slots: ["default"],
      description: "Responsive grid of children.",
    },
    Card: {
      props: z.object({ title, description: label.optional() }),
      slots: ["default"],
      description: "A panel grouping related content.",
    },
    Heading: {
      props: z.object({
        text: label,
        level: z.enum(["h1", "h2", "h3"]).optional(),
      }),
      description: "Section heading.",
    },
    Text: {
      props: z.object({
        text: label,
        tone: z.enum(["normal", "muted", "accent"]).optional(),
      }),
      description: "Plain text; never HTML.",
    },
    Metric: {
      props: z.object({ label, value: label, detail: label.optional() }),
      description: "One prominent number and its label.",
    },
    Divider: { props: z.object({}), description: "Subtle separator." },
    Table: {
      props: z.object({
        title,
        statePath,
        columns: z
          .array(z.object({ key: label, label }))
          .min(1)
          .max(12),
      }),
      description:
        "Sortable table. statePath references an array of row objects in state.",
    },
    Board: {
      props: z.object({
        title,
        statePath,
        columns: z.array(label).min(1).max(6),
      }),
      description:
        "Editable task board. statePath references [{id,title,status,detail?}]. status matches a column. Users can edit titles and move tasks locally.",
    },
    Chart: {
      props: z.object({ title, statePath }),
      description:
        "Horizontal bar chart. statePath references [{label,value}] with numeric value.",
    },
    Input: {
      props: z.object({ label, statePath, placeholder: label.optional() }),
      description:
        "Text field bound to a string in state; persists local edits.",
    },
    Checkbox: {
      props: z.object({ label, statePath }),
      description: "Checkbox bound to a boolean in state; changes locally.",
    },
    Select: {
      props: z.object({ label, statePath, options: z.array(label).max(30) }),
      description: "Dropdown bound to a string in state.",
    },
    Button: {
      props: z.object({ label, prompt: label }),
      description:
        "Ask Codex to perform the prompt when clicked. Use only for agent actions, not ordinary local interactions.",
    },
  },
  actions: {},
});
