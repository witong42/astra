import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { emptyCanvas, validateCanvas } from "./canvas";
import { journalEntrySchema, MAX_JOURNAL_ENTRIES } from "./journal";
import { emptySurface, validateSurface } from "./surface";
import type { SavedState, Workspace } from "./types";
import { shortAppName } from "./workspace-name";

const MAX_FILE_BYTES = 64 * 1024 * 1024;
export const DEFAULT_WORKSPACE_DIRECTORY = join(homedir(), ".astra");
const messageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string().max(100_000),
});
const workspaceSchema = z.object({
  id: z.string(),
  name: z.string().max(120),
  favorite: z.boolean().default(false),
  cwd: z.string(),
  threadId: z.string().nullable(),
  messages: z.array(messageSchema).max(80),
  spec: z.unknown(),
  canvas: z.unknown().optional(),
});
const savedSchema = z.object({
  version: z.literal(1),
  activeId: z.string(),
  model: z.string(),
  reasoningEffort: z.string().max(100).default("low"),
  serviceTier: z.string().max(100).default("default"),
  workspaces: z.array(workspaceSchema).min(1).max(20),
  assistant: workspaceSchema.optional(),
  voiceEnabled: z.boolean().optional(),
  journal: z.array(journalEntrySchema).max(MAX_JOURNAL_ENTRIES).optional(),
});

export function newWorkspace(cwd: string): Workspace {
  return {
    id: crypto.randomUUID(),
    name: "New App",
    favorite: false,
    cwd,
    threadId: null,
    messages: [],
    spec: emptySurface(),
    canvas: emptyCanvas(),
  };
}

export function loadState(
  path: string,
  cwd = DEFAULT_WORKSPACE_DIRECTORY,
): SavedState {
  if (!existsSync(path)) {
    const workspace = newWorkspace(cwd);
    return {
      version: 1,
      activeId: workspace.id,
      model: "",
      reasoningEffort: "low",
      serviceTier: "default",
      workspaces: [workspace],
    };
  }
  if (statSync(path).size > MAX_FILE_BYTES)
    throw new Error("Astra saved state is too large to load.");
  const parsed = savedSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.workspaces.some((workspace) => workspace.id === parsed.activeId))
    throw new Error("Astra saved workspace is missing.");
  const { assistant, ...saved } = parsed;
  return {
    ...saved,
    workspaces: parsed.workspaces.map(restoreWorkspace),
    ...(assistant ? { assistant: restoreWorkspace(assistant) } : {}),
  };
}
function restoreWorkspace(
  workspace: z.infer<typeof workspaceSchema>,
): Workspace {
  return {
    ...workspace,
    name: shortAppName(workspace.name),
    spec: validateSurface(workspace.spec),
    canvas: workspace.canvas ? validateCanvas(workspace.canvas) : null,
  };
}

export function saveState(path: string, state: SavedState) {
  const content = JSON.stringify(state);
  if (Buffer.byteLength(content) > MAX_FILE_BYTES)
    throw new Error(
      "Saved apps exceed the 64 MB limit. Delete unused apps or restore a smaller canvas.",
    );
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, content, { mode: 0o600 });
  chmodSync(temporary, 0o600);
  renameSync(temporary, path);
}
