/**
 * The Dynamic Partial Updates protocol: the model emits one JSON op per line
 * (NDJSON). Each op is a surgical patch against the living document.
 */

export const OP_ACTIONS = [
  "replace",
  "append",
  "prepend",
  "remove",
  "style",
  "attr",
  "note",
  "freeform",
] as const;

export type OpAction = (typeof OP_ACTIONS)[number];

export type MutationOp =
  | { op: "replace" | "append" | "prepend"; sel: string; html: string }
  | { op: "remove"; sel: string }
  | { op: "style"; css: string }
  | { op: "attr"; sel: string; name: string; value: string }
  | { op: "note"; text: string }
  | { op: "freeform" };

// Fragments legitimately carry inline <script> now (games, widgets), so the
// budget is sized for code, not just markup.
export const MAX_HTML_LENGTH = 100_000;
export const MAX_CANVAS_BYTES = 2 * 1024 * 1024;
export const CANVAS_SIZE_ERROR =
  "The canvas exceeds its 2 MB save limit. Chat is still available; ask Codex to reduce the canvas.";
export const MAX_CSS_LENGTH = 20_000;
export const MAX_SELECTOR_LENGTH = 300;
export const MAX_NOTE_LENGTH = 500;

const ATTR_NAME_PATTERN = /^[a-zA-Z][\w-]*$/;

export type ParseResult =
  | { ok: true; op: MutationOp }
  | { ok: false; error: string };

/** Split a stream buffer into complete lines plus the unfinished remainder. */
export function extractCompleteLines(buffer: string): {
  lines: string[];
  rest: string;
} {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  const lines = parts
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return { lines, rest };
}

/** Parse one NDJSON line into a validated op. Tolerates markdown fences and junk. */
export function parseOpLine(rawLine: string): ParseResult {
  const line = rawLine.trim();
  if (line.length === 0 || line.startsWith("```")) {
    return { ok: false, error: "empty or fence line" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return { ok: false, error: `not valid JSON: ${line.slice(0, 80)}` };
  }
  return validateOp(parsed);
}

export function validateOp(candidate: unknown): ParseResult {
  if (
    typeof candidate !== "object" ||
    candidate === null ||
    Array.isArray(candidate)
  ) {
    return { ok: false, error: "op must be a JSON object" };
  }
  const record = candidate as Record<string, unknown>;
  const action = record.op;
  if (typeof action !== "string" || !OP_ACTIONS.includes(action as OpAction)) {
    return { ok: false, error: `unknown op "${String(action)}"` };
  }

  switch (action as OpAction) {
    case "freeform":
      return { ok: true, op: { op: "freeform" } };
    case "replace":
    case "append":
    case "prepend": {
      const selError = checkSelector(record.sel);
      if (selError) return { ok: false, error: selError };
      if (typeof record.html !== "string" || record.html.length === 0) {
        return { ok: false, error: `${action} op requires non-empty "html"` };
      }
      if (record.html.length > MAX_HTML_LENGTH) {
        return { ok: false, error: `html exceeds ${MAX_HTML_LENGTH} chars` };
      }
      return {
        ok: true,
        op: {
          op: action as "replace" | "append" | "prepend",
          sel: record.sel as string,
          html: record.html,
        },
      };
    }
    case "remove": {
      const selError = checkSelector(record.sel);
      if (selError) return { ok: false, error: selError };
      return { ok: true, op: { op: "remove", sel: record.sel as string } };
    }
    case "style": {
      if (typeof record.css !== "string" || record.css.trim().length === 0) {
        return { ok: false, error: 'style op requires non-empty "css"' };
      }
      if (record.css.length > MAX_CSS_LENGTH) {
        return { ok: false, error: `css exceeds ${MAX_CSS_LENGTH} chars` };
      }
      if (/shell-root|data-shell/i.test(record.css)) {
        return { ok: false, error: "css must not target the shell UI" };
      }
      return { ok: true, op: { op: "style", css: record.css } };
    }
    case "attr": {
      const selError = checkSelector(record.sel);
      if (selError) return { ok: false, error: selError };
      if (
        typeof record.name !== "string" ||
        !ATTR_NAME_PATTERN.test(record.name)
      ) {
        return { ok: false, error: "attr op requires a valid attribute name" };
      }
      if (typeof record.value !== "string") {
        return { ok: false, error: 'attr op requires string "value"' };
      }
      return {
        ok: true,
        op: {
          op: "attr",
          sel: record.sel as string,
          name: record.name,
          value: record.value,
        },
      };
    }
    case "note": {
      if (typeof record.text !== "string" || record.text.trim().length === 0) {
        return { ok: false, error: 'note op requires non-empty "text"' };
      }
      return {
        ok: true,
        op: { op: "note", text: record.text.slice(0, MAX_NOTE_LENGTH) },
      };
    }
  }
}

function checkSelector(sel: unknown): string | null {
  if (typeof sel !== "string" || sel.trim().length === 0) {
    return 'op requires non-empty "sel" selector';
  }
  if (sel.length > MAX_SELECTOR_LENGTH) {
    return `selector exceeds ${MAX_SELECTOR_LENGTH} chars`;
  }
  return null;
}
