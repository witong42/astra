import { z } from "zod";
import {
  inspectOpenUI,
  MAX_OPENUI_BYTES,
  openuiSchema,
  validateOpenUIState,
} from "./openui";
import {
  CANVAS_SIZE_ERROR,
  MAX_CANVAS_BYTES,
  type MutationOp,
  parseOpLine,
  validateOp,
} from "./substrate-protocol";
import { MAX_APP_NAME_LENGTH } from "./workspace-name";

export { MAX_CANVAS_BYTES } from "./substrate-protocol";

const MAX_HISTORY = 8;
const MAX_PENDING_OPS = 24;
const documentSchema = z.object({
  html: z.string().max(MAX_CANVAS_BYTES),
  css: z.string().max(MAX_CANVAS_BYTES),
  generation: z.number().int().nonnegative(),
  openui: openuiSchema.optional(),
});
export type CanvasDocument = z.infer<typeof documentSchema>;
export type CanvasState = CanvasDocument & {
  revision: number;
  pending: { id: number; op: MutationOp }[];
  history: CanvasDocument[];
};
export const canvasAckSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    html: z.string().max(MAX_CANVAS_BYTES),
    css: z.string().max(MAX_CANVAS_BYTES),
    error: z.string().max(2000).optional(),
  })
  .strict();
export type CanvasAck = z.infer<typeof canvasAckSchema>;
export function emptyCanvas(): CanvasState {
  return {
    html: '<main id="substrate"></main>',
    css: "",
    generation: 0,
    revision: 0,
    pending: [],
    history: [],
  };
}
export function validateCanvas(value: unknown): CanvasState {
  const canvas = documentSchema
    .extend({
      revision: z.number().int().nonnegative(),
      pending: z
        .array(z.object({ id: z.number().int().positive(), op: z.unknown() }))
        .max(MAX_PENDING_OPS),
      history: z.array(documentSchema).max(MAX_HISTORY),
    })
    .parse(value);
  let previous = canvas.revision;
  const pending = canvas.pending.map((entry) => {
    const result = validateOp(entry.op);
    if (!result.ok) throw new Error(result.error);
    if (entry.id <= previous)
      throw new Error("Canvas operations are out of order.");
    previous = entry.id;
    return { id: entry.id, op: result.op };
  });
  for (const doc of [canvas, ...canvas.history]) {
    checkSize(doc);
    if (doc.openui) {
      inspectOpenUI(doc.openui.source);
      validateOpenUIState(doc.openui.state);
    }
  }
  return { ...canvas, pending };
}
function checkSize(document: { html: string; css: string }) {
  if (
    new TextEncoder().encode(document.html + document.css).byteLength >
    MAX_CANVAS_BYTES
  )
    throw new Error(CANVAS_SIZE_ERROR);
}
function currentDocument(canvas: CanvasState): CanvasDocument {
  return structuredClone({
    html: canvas.html,
    css: canvas.css,
    generation: canvas.generation,
    ...(canvas.openui ? { openui: canvas.openui } : {}),
  });
}
export function beginCanvasGeneration(canvas: CanvasState) {
  if (canvas.pending.length)
    throw new Error(
      "Wait for the canvas to finish rendering before changing it.",
    );
  canvas.history.push(currentDocument(canvas));
  canvas.history = canvas.history.slice(-MAX_HISTORY);
  canvas.generation++;
}
export function queueCanvasOp(canvas: CanvasState, input: unknown) {
  const result = validateOp(input);
  if (!result.ok) throw new Error(result.error);
  if (result.op.op === "freeform")
    throw new Error("Layout changes must be applied by the host.");
  if (canvas.pending.length >= MAX_PENDING_OPS)
    throw new Error("Too many pending canvas updates.");
  const id = (canvas.pending.at(-1)?.id ?? canvas.revision) + 1;
  canvas.pending.push({ id, op: result.op });
}
export function acknowledgeCanvas(
  canvas: CanvasState,
  input: unknown,
): string | undefined {
  const ack = canvasAckSchema.parse(input);
  checkSize(ack);
  if (ack.revision < canvas.revision) return;
  if (ack.revision > (canvas.pending.at(-1)?.id ?? canvas.revision))
    throw new Error("The canvas acknowledged an unknown update.");
  canvas.html = ack.html;
  canvas.css = ack.css;
  canvas.revision = ack.revision;
  canvas.pending = canvas.pending.filter((entry) => entry.id > ack.revision);
  return ack.error;
}
export function restoreCanvas(
  canvas: CanvasState,
  index = canvas.history.length - 1,
) {
  if (canvas.pending.length)
    throw new Error(
      "Wait for the canvas to finish rendering before restoring it.",
    );
  const previous = canvas.history.splice(index, 1)[0];
  if (!previous) throw new Error("There is no previous canvas version.");
  canvas.history.push(currentDocument(canvas));
  canvas.html = previous.html;
  canvas.css = previous.css;
  if (previous.openui) canvas.openui = previous.openui;
  else delete canvas.openui;
  canvas.generation++;
  canvas.revision++;
}

export class CanvasStream {
  private buffer = "";
  private fence: "canvas" | "openui" | "name" | "text" | null = null;
  private nameSource = "";
  private nameRejected = false;
  private openuiSource = "";
  private openuiRejected = false;
  private operations = 0;
  constructor(
    private onOp: (op: MutationOp) => void,
    private onText: (text: string) => void,
    private onError: (error: string) => void,
    private onOpenUI?: (source: string, complete: boolean) => void,
    private onName?: (name: string) => void,
  ) {}
  push(chunk: string) {
    this.buffer += chunk;
    if (this.buffer.length > MAX_CANVAS_BYTES) {
      this.buffer = "";
      this.onError("Canvas operation is too large.");
      return;
    }
    while (this.buffer.includes("\n")) {
      const end = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      this.line(line);
    }
  }
  flush() {
    if (this.buffer) this.line(this.buffer);
    this.buffer = "";
    if (this.fence === "openui") this.emitOpenUI(true);
  }
  private emitOpenUI(complete: boolean) {
    if (this.openuiRejected) return;
    try {
      if (!this.onOpenUI)
        throw new Error("OpenUI is unavailable in this renderer.");
      this.onOpenUI(this.openuiSource, complete);
    } catch (error) {
      if (complete)
        this.onError(error instanceof Error ? error.message : String(error));
    }
  }
  private line(line: string) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (this.fence) {
        if (this.fence === "text") this.onText(`${line}\n`);
        if (this.fence === "openui") this.emitOpenUI(true);
        if (this.fence === "name" && !this.nameRejected) {
          try {
            this.onName?.(this.nameSource.trim());
          } catch (error) {
            this.onError(
              error instanceof Error ? error.message : String(error),
            );
          }
        }
        this.fence = null;
      } else {
        this.fence = /^```(?:astra|codexos)-name\s*$/.test(trimmed)
          ? "name"
          : /^```openui\s*$/.test(trimmed)
            ? "openui"
            : /^```(?:substrate|canvas)\s*$/.test(trimmed)
              ? "canvas"
              : "text";
        if (this.fence === "openui") {
          this.openuiSource = "";
          this.openuiRejected = false;
        }
        if (this.fence === "name") {
          this.nameSource = "";
          this.nameRejected = false;
        }
        if (this.fence === "text") this.onText(`${line}\n`);
      }
      return;
    }
    if (this.fence === "name") {
      if (this.nameRejected) return;
      this.nameSource += `${line}\n`;
      if (this.nameSource.trim().length > MAX_APP_NAME_LENGTH) {
        this.nameRejected = true;
        this.nameSource = "";
        this.onError(
          "Use an app name of one or two words, up to 32 characters.",
        );
      }
      return;
    }
    if (this.fence === "openui") {
      if (this.openuiRejected) return;
      this.openuiSource += `${line}\n`;
      if (
        new TextEncoder().encode(this.openuiSource).byteLength >
        MAX_OPENUI_BYTES
      ) {
        this.onError("OpenUI program is too large.");
        this.openuiRejected = true;
        this.openuiSource = "";
      } else this.emitOpenUI(false);
      return;
    }
    if (
      this.fence === "canvas" ||
      (!this.fence && /^\{\s*"op"\s*:/.test(trimmed))
    ) {
      if (!trimmed) return;
      const result = parseOpLine(line);
      if (!result.ok) {
        this.onError(result.error);
        return;
      }
      if (result.op.op === "note") this.onText(`${result.op.text}\n`);
      else if (this.operations++ < MAX_PENDING_OPS) this.onOp(result.op);
      else this.onError("Canvas generation exceeded its 24-operation limit.");
    } else this.onText(`${line}\n`);
  }
}
