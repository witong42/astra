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
