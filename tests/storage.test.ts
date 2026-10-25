import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_CANVAS_BYTES } from "../src/canvas";
import { loadState, newWorkspace, saveState } from "../src/storage";

const directories: string[] = [];
function file() {
  const directory = mkdtempSync(join(tmpdir(), "astra-storage-test-"));
  directories.push(directory);
  return join(directory, "workspace.json");
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true });
});

test("large canvases and their eight saved versions survive saving and reopening", () => {
  const path = file();
  const state = loadState(path, "/tmp");
  const canvas = state.workspaces[0].canvas;
  if (!canvas) throw new Error("Missing test canvas");
  canvas.html = `<main id="substrate">${"x".repeat(MAX_CANVAS_BYTES - 100)}</main>`;
  canvas.history = Array.from({ length: 8 }, (_, generation) => ({
    html: canvas.html,
    css: "",
    generation,
  }));
  saveState(path, state);
  expect(loadState(path, "/tmp")).toEqual(state);
});

test("new installations use the personal .astra directory rather than the source repository", () => {
  const state = loadState(file());
  expect(state.workspaces[0].cwd).toBe(join(homedir(), ".astra"));
});

describe("saved workspaces", () => {
  test("round trips edited UI data and conversation identity with private permissions", () => {
    const path = file();
    const state = loadState(path, "/tmp");
    state.workspaces[0].threadId = "thread-to-resume";
    state.reasoningEffort = "high";
    state.serviceTier = "priority";
    state.workspaces[0].spec.state = {
      notes: "My edits",
      tasks: [{ id: "1", title: "Keep me", status: "Doing" }],
    };
    saveState(path, state);
    expect(loadState(path, "/elsewhere")).toEqual(state);
    if (process.platform !== "win32")
      expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("does not overwrite a damaged existing workspace", () => {
    const path = file();
    writeFileSync(path, "invalid original data");
    expect(() => loadState(path, "/tmp")).toThrow();
    expect(readFileSync(path, "utf8")).toBe("invalid original data");
  });
});

test("loads previous Astra workspaces without discarding their original view or edits", () => {
  const path = file();
  const state = loadState(path, "/tmp");
  const previous = JSON.parse(JSON.stringify(state));
  delete previous.workspaces[0].canvas;
  previous.workspaces[0].spec.state = { notes: "Keep my original notes" };
  writeFileSync(path, JSON.stringify(previous));
  const loaded = loadState(path, "/tmp");
  expect(loaded.workspaces[0].canvas).toBeNull();
  expect(loaded.workspaces[0].spec.state?.notes).toBe("Keep my original notes");
  expect(loaded.workspaces[0].id).toBe(previous.workspaces[0].id);
});

test("favorites persist and old workspaces start unfavorited without losing content", () => {
  const path = file();
  const state = loadState(path, "/tmp");
  const first = state.workspaces[0];
  expect(first.favorite).toBe(false);
  first.favorite = true;
  saveState(path, state);
  expect(loadState(path, "/tmp").workspaces[0].favorite).toBe(true);
  const old = JSON.parse(readFileSync(path, "utf8"));
  delete old.workspaces[0].favorite;
  writeFileSync(path, JSON.stringify(old));
  expect(loadState(path, "/tmp").workspaces[0].favorite).toBe(false);
});

test("legacy prompt names become short app names while content and identities stay intact", () => {
  const path = file();
  const state = loadState(path, "/tmp");
  state.workspaces[0].name =
    "Create an orbit dashboard with interactive controls";
  state.workspaces[0].messages = [
    { id: "message", role: "user", text: "Original full request" },
  ];
  state.workspaces[0].threadId = "retain-thread";
  saveState(path, state);
  const loaded = loadState(path, "/elsewhere");
  expect(loaded.workspaces[0]).toEqual({
    ...state.workspaces[0],
    name: "Orbit Lab",
  });
  saveState(path, loaded);
  expect(loadState(path, "/tmp")).toEqual(loaded);
});

test("Astra's hidden assistant and wake preference survive upgrades without changing apps", () => {
  const directory = mkdtempSync(join(tmpdir(), "astra-storage-test-"));
  try {
    const path = join(directory, "workspace.json");
    const state = loadState(path, directory);
    const original = structuredClone(state.workspaces);
    state.assistant = newWorkspace(directory);
    state.assistant.name = "Astra";
    state.assistant.threadId = "assistant-thread";
    state.assistant.messages = [
      { id: "spoken", role: "user", text: "Bonjour" },
    ];
    state.voiceEnabled = true;
    saveState(path, state);
    const restored = loadState(path, directory);
    expect(restored.workspaces).toEqual(original);
    expect(restored.assistant).toEqual(state.assistant);
    expect(restored.voiceEnabled).toBe(true);
  } finally {
    rmSync(directory, { recursive: true });
  }
});

test("the continuous journal survives saving and reopening with its original timestamps", () => {
  const path = file();
  const state = loadState(path, "/tmp");
  state.journal = [
    {
      id: "voice",
      at: 12345,
      kind: "user",
      source: "voice",
      text: "Ouvre la calculatrice",
    },
  ];
  saveState(path, state);
  expect(loadState(path, "/tmp").journal).toEqual(state.journal);
});
