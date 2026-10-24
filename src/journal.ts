import { z } from "zod";
import type { SavedState, Workspace } from "./types";

export const MAX_JOURNAL_ENTRIES = 2000;
export const MAX_JOURNAL_TEXT = 12_000;
const TOOL_RESULT_LIMIT = 4000;
export const journalEntrySchema = z.object({
  id: z.string(),
  at: z.number().finite().nonnegative(),
  kind: z.enum(["user", "assistant", "action"]),
  source: z.enum(["voice", "text", "tool"]),
  text: z.string().max(MAX_JOURNAL_TEXT),
  detail: z.string().max(MAX_JOURNAL_TEXT).optional(),
  workspaceId: z.string().optional(),
  status: z.enum(["running", "completed", "failed"]).optional(),
});
export type JournalEntry = z.infer<typeof journalEntrySchema>;

export function initialJournal(saved: SavedState): JournalEntry[] {
  if (saved.journal) return saved.journal;
  return [...saved.workspaces, ...(saved.assistant ? [saved.assistant] : [])]
    .flatMap((workspace) =>
      workspace.messages
        .filter((message) => message.text.trim())
        .map(
          (message): JournalEntry => ({
            id: message.id,
            at: 0,
            kind: message.role,
            source: "text",
            text: message.text.slice(-MAX_JOURNAL_TEXT),
            workspaceId: workspace.id,
          }),
        ),
    )
    .slice(-MAX_JOURNAL_ENTRIES);
}

export function recordJournal(
  entries: JournalEntry[],
  input: Omit<JournalEntry, "at">,
) {
  const previous = entries.find((entry) => entry.id === input.id);
  const entry = {
    ...input,
    text: input.text.slice(-MAX_JOURNAL_TEXT),
    ...(input.detail ? { detail: input.detail.slice(-MAX_JOURNAL_TEXT) } : {}),
    at: previous?.at ?? Date.now(),
  };
  if (previous) Object.assign(previous, entry);
  else entries.push(entry);
  if (entries.length > MAX_JOURNAL_ENTRIES)
    entries.splice(0, entries.length - MAX_JOURNAL_ENTRIES);
}

export function toolJournalEntry(
  item: Record<string, unknown>,
  workspaceId: string,
  completed: boolean,
): Omit<JournalEntry, "at"> | null {
  if (typeof item.id !== "string") return null;
  const labels: Record<string, string> = {
    commandExecution: "Commande",
    fileChange: "Modification de fichiers",
    mcpToolCall: "Action dans une application",
    dynamicToolCall: "Action",
    webSearch: "Recherche web",
    computerUse: "Action sur l’ordinateur",
  };
  const label = labels[String(item.type)];
  if (!label || item.tool === "astra" || item.tool === "codexos_app")
    return null;
  const command =
    typeof item.command === "string"
      ? item.command
      : Array.isArray(item.command)
        ? item.command.join(" ")
        : "";
  const result = item.aggregatedOutput ?? item.result ?? item.error;
  const output =
    result === undefined
      ? ""
      : typeof result === "string"
        ? result
        : JSON.stringify(result);
  const details = [
    command,
    typeof item.tool === "string" ? item.tool : "",
    typeof item.query === "string" ? item.query : "",
    Array.isArray(item.changes)
      ? item.changes
          .map((change) => String((change as { path?: string }).path ?? ""))
          .filter(Boolean)
          .join("\n")
      : "",
    output.slice(-TOOL_RESULT_LIMIT),
  ].filter(Boolean);
  const failed =
    item.status === "failed" ||
    item.isError === true ||
    (typeof item.exitCode === "number" && item.exitCode !== 0) ||
    Boolean(item.error);
  return {
    id: `${workspaceId}:${item.id}`,
    workspaceId,
    kind: "action",
    source: "tool",
    text: label,
    ...(details.length
      ? { detail: details.join("\n").slice(-MAX_JOURNAL_TEXT) }
      : {}),
    status: failed ? "failed" : completed ? "completed" : "running",
  };
}

export function appJournalEntry(
  input: unknown,
  result: unknown,
  workspaces: Workspace[],
  error?: unknown,
): Omit<JournalEntry, "at"> | null {
  if (!input || typeof input !== "object") return null;
  const request = input as { action?: string; id?: string; name?: string };
  const labels: Record<string, string> = {
    home: "Retour à l’accueil",
    create: "Mini-app créée",
    update: "Modification envoyée",
    open: "Mini-app ouverte",
    click: "Commande activée",
    fill: "Champ renseigné",
  };
  const label = labels[request.action ?? ""];
  if (!label) return null;
  const output =
    result && typeof result === "object"
      ? (result as { id?: string })
      : undefined;
  const workspaceId = request.id ?? output?.id;
  const name =
    workspaces.find((workspace) => workspace.id === workspaceId)?.name ??
    request.name;
  return {
    id: crypto.randomUUID(),
    kind: "action",
    source: "tool",
    text: name ? `${label} · ${name}` : label,
    ...(workspaceId ? { workspaceId } : {}),
    ...(error ? { detail: String(error).slice(-MAX_JOURNAL_TEXT) } : {}),
    status: error ? "failed" : "completed",
  };
}
