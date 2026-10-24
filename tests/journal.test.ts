import { expect, test } from "bun:test";
import {
  appJournalEntry,
  initialJournal,
  type JournalEntry,
  MAX_JOURNAL_ENTRIES,
  MAX_JOURNAL_TEXT,
  recordJournal,
  toolJournalEntry,
} from "../src/journal";
import { newWorkspace } from "../src/storage";
import type { SavedState } from "../src/types";

test("streaming journal updates preserve their place and timestamp without duplicates", () => {
  const entries: JournalEntry[] = [];
  recordJournal(entries, {
    id: "user",
    kind: "user",
    source: "voice",
    text: "Bonjour",
  });
  recordJournal(entries, {
    id: "reply",
    kind: "assistant",
    source: "voice",
    text: "Bon",
  });
  const time = entries[1].at;
  recordJournal(entries, {
    id: "action",
    kind: "action",
    source: "tool",
    text: "Calculatrice ouverte",
    status: "completed",
  });
  recordJournal(entries, {
    id: "reply",
    kind: "assistant",
    source: "voice",
    text: "Bonjour William",
  });
  expect(entries.map((entry) => entry.id)).toEqual(["user", "reply", "action"]);
  expect(entries[1]).toMatchObject({ text: "Bonjour William", at: time });
});

test("journal limits preserve recent entries and bound an oversized result", () => {
  const entries: JournalEntry[] = Array.from(
    { length: MAX_JOURNAL_ENTRIES },
    (_, index) => ({
      id: String(index),
      at: index,
      kind: "action",
      source: "tool",
      text: "Previous action",
    }),
  );
  recordJournal(entries, {
    id: "new",
    kind: "action",
    source: "tool",
    text: "x".repeat(MAX_JOURNAL_TEXT + 1),
  });
  expect(entries).toHaveLength(MAX_JOURNAL_ENTRIES);
  expect(entries[0].id).toBe("1");
  expect(entries.at(-1)?.text).toHaveLength(MAX_JOURNAL_TEXT);
});

test("legacy conversations enter the journal without inventing dates or altering app data", () => {
  const app = newWorkspace("/tmp");
  app.messages = [{ id: "kept", role: "user", text: "My original note" }];
  const saved: SavedState = {
    version: 1,
    activeId: app.id,
    model: "test",
    reasoningEffort: "low",
    serviceTier: "default",
    workspaces: [app],
  };
  const original = structuredClone(saved);
  expect(initialJournal(saved)).toEqual([
    {
      id: "kept",
      at: 0,
      kind: "user",
      source: "text",
      text: "My original note",
      workspaceId: app.id,
    },
  ]);
  expect(saved).toEqual(original);
});

test("tool actions retain confirmed results, failures, and workspace identity", () => {
  expect(
    toolJournalEntry(
      {
        id: "cmd",
        type: "commandExecution",
        command: "open Calculator",
        exitCode: 0,
        aggregatedOutput: "Done",
      },
      "app",
      true,
    ),
  ).toMatchObject({
    workspaceId: "app",
    status: "completed",
    detail: "open Calculator\nDone",
  });
  expect(
    toolJournalEntry(
      {
        id: "cmd",
        type: "commandExecution",
        exitCode: 1,
        aggregatedOutput: "Permission denied",
      },
      "app",
      true,
    )?.status,
  ).toBe("failed");
  expect(
    toolJournalEntry({ id: "thought", type: "reasoning" }, "app", true),
  ).toBeNull();
  expect(
    toolJournalEntry(
      { id: "native", type: "dynamicToolCall", tool: "astra" },
      "app",
      true,
    ),
  ).toBeNull();
  const app = { ...newWorkspace("/tmp"), name: "Inner Atlas" };
  expect(
    appJournalEntry({ action: "open", id: app.id }, { opened: true }, [app]),
  ).toMatchObject({
    workspaceId: app.id,
    text: "Mini-app ouverte · Inner Atlas",
    status: "completed",
  });
  expect(appJournalEntry({ action: "status" }, {}, [app])).toBeNull();
});
