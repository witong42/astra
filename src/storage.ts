import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { emptySurface, validateSurface } from "./surface";
import type { SavedState, Workspace } from "./types";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string().max(100_000),
});
const savedSchema = z.object({
  version: z.literal(1),
  activeId: z.string(),
  model: z.string(),
  workspaces: z
    .array(
      z.object({
        id: z.string(),
        name: z.string().max(120),
        cwd: z.string(),
        threadId: z.string().nullable(),
        messages: z.array(messageSchema).max(80),
        spec: z.unknown(),
      }),
    )
    .min(1)
    .max(20),
});

export function newWorkspace(cwd: string): Workspace {
  return {
    id: crypto.randomUUID(),
    name: "New workspace",
    cwd,
    threadId: null,
    messages: [],
    spec: emptySurface(),
  };
}

export function loadState(path: string, cwd: string): SavedState {
  if (!existsSync(path)) {
    const workspace = newWorkspace(cwd);
    return {
      version: 1,
      activeId: workspace.id,
      model: "",
      workspaces: [workspace],
    };
  }
  if (statSync(path).size > MAX_FILE_BYTES)
    throw new Error("CodexOS saved state is too large to load.");
  const parsed = savedSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.workspaces.some((workspace) => workspace.id === parsed.activeId))
    throw new Error("CodexOS saved workspace is missing.");
  return {
    ...parsed,
    workspaces: parsed.workspaces.map((workspace) => ({
      ...workspace,
      spec: validateSurface(workspace.spec),
    })),
  };
}

export function saveState(path: string, state: SavedState) {
  const content = JSON.stringify(state);
  if (Buffer.byteLength(content) > MAX_FILE_BYTES)
    throw new Error(
      "CodexOS history reached its 10 MB limit. Create a fresh local data store before continuing.",
    );
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, content, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}
