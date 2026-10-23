import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, saveState } from "../src/storage";

const directories: string[] = [];
function file() {
  const directory = mkdtempSync(join(tmpdir(), "codexos-storage-test-"));
  directories.push(directory);
  return join(directory, "workspace.json");
}
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true });
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
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  test("does not overwrite a damaged existing workspace", () => {
    const path = file();
    writeFileSync(path, "invalid original data");
    expect(() => loadState(path, "/tmp")).toThrow();
    expect(readFileSync(path, "utf8")).toBe("invalid original data");
  });
});

test("loads previous CodexOS workspaces without discarding their original view or edits", () => {
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
