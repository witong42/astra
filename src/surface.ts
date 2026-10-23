import { applySpecPatch, type JsonPatch, type Spec } from "@json-render/core";
import { z } from "zod";
import { catalog } from "./catalog";

export const MAX_SURFACE_BYTES = 512 * 1024;
const MAX_ELEMENTS = 300;
const MAX_RENDERED_ELEMENTS = 600;
const MAX_DEPTH = 24;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const binding = z
  .object({ $state: z.string().startsWith("/").max(300) })
  .strict();
const propSchemas = Object.fromEntries(
  Object.entries(catalog.data.components).map(([name, definition]) => [
    name,
    z
      .object(
        Object.fromEntries(
          Object.entries(definition.props.shape).map(([key, field]) => [
            key,
            key === "statePath"
              ? (field as z.ZodType)
              : (field as z.ZodType).or(binding),
          ]),
        ),
      )
      .strict(),
  ]),
);
const pointer = z
  .string()
  .max(1_000)
  .refine(
    (value) =>
      /^\/(root|elements|state)(\/|$)/.test(value) &&
      !value
        .split("/")
        .some((part) =>
          FORBIDDEN_KEYS.has(part.replace(/~1/g, "/").replace(/~0/g, "~")),
        ),
    "Invalid UI path",
  );
const patchSchema = z
  .object({
    op: z.enum(["add", "replace", "remove", "move", "copy", "test"]),
    path: pointer,
    from: pointer.optional(),
    value: z.unknown().optional(),
  })
  .strict();

export const emptySurface = (): Spec => ({ root: "", elements: {}, state: {} });

export function validateJson(value: unknown, depth = 0): void {
  if (depth > MAX_DEPTH) throw new Error("UI data is nested too deeply.");
  if (typeof value === "number" && !Number.isFinite(value))
    throw new Error("UI numbers must be finite.");
  if (value === null || ["string", "boolean", "number"].includes(typeof value))
    return;
  if (Array.isArray(value)) {
    for (const item of value) validateJson(item, depth + 1);
    return;
  }
  if (typeof value !== "object" || !value)
    throw new Error("UI values must be JSON data.");
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error("Unsafe key in UI data.");
    validateJson(item, depth + 1);
  }
}

export function validateSurface(value: unknown): Spec {
  validateJson(value);
  if (JSON.stringify(value).length > MAX_SURFACE_BYTES)
    throw new Error("Generated UI exceeds the 512 KB limit.");
  const normalized = z
    .object({
      root: z.string(),
      elements: z.record(
        z.string(),
        z
          .object({
            type: z.string(),
            props: z.record(z.string(), z.unknown()),
            children: z.array(z.string()).optional(),
          })
          .strict(),
      ),
      state: z.record(z.string(), z.unknown()).optional(),
    })
    .parse(structuredClone(value));
  for (const element of Object.values(normalized.elements))
    element.children ??= [];
  const result = catalog.validate(normalized);
  if (!result.success)
    throw new Error(
      `Invalid UI: ${result.error?.message ?? "component properties do not match the catalog"}`,
    );
  const spec = { ...result.data, state: normalized.state ?? {} } as Spec;
  const entries = Object.entries(spec.elements);
  if (entries.length > MAX_ELEMENTS)
    throw new Error("Generated UI has too many components.");
  for (const [, element] of entries) {
    const propsSchema = propSchemas[element.type];
    if (!propsSchema) throw new Error(`Unknown UI component: ${element.type}`);
    element.props = propsSchema.parse(element.props);
    for (const [key, prop] of Object.entries(element.props)) {
      if (key === "statePath" && typeof prop === "string")
        pointer.parse(`/state${prop}`);
      if (prop && typeof prop === "object" && "$state" in prop)
        pointer.parse(`/state${String(prop.$state)}`);
    }
    if (element.on && Object.keys(element.on).length)
      throw new Error(
        "Use registered component interactions instead of arbitrary action bindings.",
      );
  }
  const sizes = new Map<string, number>();
  const visit = (id: string, ancestors: Set<string>): number => {
    if (ancestors.has(id))
      throw new Error("Generated UI contains a component cycle.");
    if (ancestors.size > MAX_DEPTH)
      throw new Error("Generated UI is nested too deeply.");
    const cached = sizes.get(id);
    if (cached !== undefined) return cached;
    const element = spec.elements[id];
    if (!element) return 0;
    const next = new Set(ancestors).add(id);
    let size = 1;
    for (const child of element.children ?? []) {
      size += visit(child, next);
      if (size > MAX_RENDERED_ELEMENTS)
        throw new Error("Generated UI expands to too many components.");
    }
    sizes.set(id, size);
    return size;
  };
  for (const [id] of entries) visit(id, new Set());
  return spec;
}

export function applySurfacePatch(current: Spec, input: unknown): Spec {
  if (JSON.stringify(input).length > MAX_SURFACE_BYTES)
    throw new Error("Generated UI patch is too large.");
  const patch = patchSchema.parse(input);
  if (patch.value !== undefined) validateJson(patch.value);
  if (["move", "copy"].includes(patch.op) && !patch.from)
    throw new Error("UI patch requires a source path.");
  if (
    ["add", "replace", "test"].includes(patch.op) &&
    !Object.hasOwn(patch, "value")
  )
    throw new Error("UI patch requires a value.");
  const candidate = structuredClone(current);
  applySpecPatch(candidate, patch as JsonPatch);
  return validateSurface(candidate);
}
