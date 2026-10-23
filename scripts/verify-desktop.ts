import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import type { Snapshot } from "../src/types";
import { desktopClient } from "./desktop-client";

const client = await desktopClient();
const started = Date.now();
const snapshots: {
  elapsed: number;
  status: string;
  patches: number;
  error: string | null;
}[] = [];
const snapshot = () => client.evaluate<Snapshot>("window.codexos.snapshot()");
const currentWorkspace = (state: Snapshot) => {
  const workspace = state.workspaces.find(
    (entry) => entry.id === state.activeId,
  );
  assert.ok(workspace, "The active workspace must exist");
  return workspace;
};
const waitUntil = async (
  predicate: (state: Snapshot) => boolean,
  timeout = 120_000,
) => {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const state = await snapshot();
    if (predicate(state)) return state;
    if (state.approval)
      throw new Error(
        `Unexpected request during UI generation: ${state.approval.summary}`,
      );
    if (state.status === "offline")
      throw new Error(state.error ?? "Codex disconnected");
    await Bun.sleep(200);
  }
  throw new Error("Desktop verification timed out");
};
const submit = async (text: string) => {
  await client.evaluate('document.querySelector("textarea").focus()');
  await client.call("Input.insertText", { text });
  await client.call("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
  await client.call("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Enter",
    code: "Enter",
    windowsVirtualKeyCode: 13,
  });
};

try {
  await waitUntil((state) => state.status === "ready");
  const origin = await client.evaluate<number>("performance.timeOrigin");
  const initial = await snapshot();
  if (currentWorkspace(initial).messages.length)
    await client.evaluate("window.codexos.newWorkspace()");
  await submit(
    "Create a compact weekly planning workspace. Use a Stack containing a Heading reading 'This week', an editable Board with To do, Doing, Done columns, and an Input labelled Notes. Add two example tasks: 'Shape the workspace' in To do and 'Try live UI' in Doing. Store the tasks in /tasks and Notes in /notes with an empty initial string. Output only streamed spec patches. Do not inspect files or use tools.",
  );
  let sawProgressiveView = false;
  await waitUntil((state) => {
    snapshots.push({
      elapsed: Date.now() - started,
      status: state.status,
      patches: state.metrics?.patches ?? 0,
      error: state.error,
    });
    if (state.metrics?.patches && state.status === "working")
      sawProgressiveView = true;
    return state.status === "ready" && Boolean(state.metrics?.total);
  });
  const generated = await snapshot();
  assert.equal(generated.error, null);
  assert.ok(sawProgressiveView, "UI must render before generation completes");
  assert.ok(
    await client.evaluate('Boolean(document.querySelector(".gen-board"))'),
  );
  const tasks = currentWorkspace(generated).spec.state?.tasks;
  assert.ok(Array.isArray(tasks));
  assert.equal(tasks.length, 2);
  console.log("LIVE_GENERATION", JSON.stringify(generated.metrics));
  await client.screenshot("test-results/desktop-generated.png");

  const localStart = performance.now();
  await client.evaluate(
    '{ const input = document.querySelector(".task-title"); input.focus(); input.select(); }',
  );
  await client.call("Input.insertText", { text: "My locally edited task" });
  await client.evaluate(
    '{ const input = [...document.querySelectorAll(".gen-field input")].find(x => x.closest(".gen-field").textContent.includes("Notes")); input.focus(); }',
  );
  await client.call("Input.insertText", {
    text: "Keep this note across layout changes.",
  });
  await waitUntil(
    (state) =>
      JSON.stringify(currentWorkspace(state).spec.state).includes(
        "Keep this note",
      ),
    5_000,
  );
  const local = await snapshot();
  assert.equal(local.status, "ready");
  assert.equal(
    currentWorkspace(local).messages.length,
    currentWorkspace(generated).messages.length,
    "Local edits must not invoke the model",
  );
  assert.ok(
    JSON.stringify(currentWorkspace(local).spec.state).includes(
      "My locally edited task",
    ),
  );
  console.log(
    "LOCAL_INTERACTION_MS",
    Math.round(performance.now() - localStart),
  );

  await submit(
    "Change only the Heading text to 'My week, my way'. Preserve all tasks, their locally edited titles and statuses, and the Notes input value. Send only the minimal spec patch. Do not use tools.",
  );
  await waitUntil((state) => state.status === "working");
  const updated = await waitUntil((state) => state.status === "ready");
  assert.equal(updated.error, null);
  assert.deepEqual(
    currentWorkspace(updated).spec.state,
    currentWorkspace(local).spec.state,
    "Layout changes must preserve local edits",
  );
  assert.ok(
    await client.evaluate(
      'document.querySelector(".generated-surface").textContent.includes("My week, my way")',
    ),
  );
  assert.equal(
    await client.evaluate<number>("performance.timeOrigin"),
    origin,
    "Generation must not reload the app",
  );
  assert.equal(
    client.errors.length,
    0,
    "Desktop must not throw renderer exceptions",
  );
  await Bun.sleep(500);
  const disk = JSON.parse(
    readFileSync(
      "/Users/william-mbp/Library/Application Support/CodexOS/workspace.json",
      "utf8",
    ),
  );
  assert.deepEqual(
    currentWorkspace(disk).spec,
    currentWorkspace(updated).spec,
    "Generated UI and edits must persist",
  );
  await client.screenshot("test-results/desktop-updated.png");
  mkdirSync("test-results", { recursive: true });
  await Bun.write(
    "test-results/desktop-verification.json",
    JSON.stringify(
      {
        firstGeneration: generated.metrics,
        incrementalUpdate: updated.metrics,
        progressive: sawProgressiveView,
        samePage: true,
        statePreserved: true,
        localEditsWithoutModel: true,
        rendererErrors: client.errors,
        snapshots,
      },
      null,
      2,
    ),
  );
  console.log(
    "DESKTOP_VERIFIED",
    JSON.stringify({
      firstGeneration: generated.metrics,
      incrementalUpdate: updated.metrics,
      progressive: sawProgressiveView,
      samePage: true,
      statePreserved: true,
      persisted: true,
      errors: client.errors.length,
    }),
  );
} finally {
  client.close();
}
