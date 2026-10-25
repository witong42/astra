import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { astraConfig } from "../src/config";
import type { Snapshot, Workspace } from "../src/types";
import { desktopClient, showWorkspace } from "./desktop-client";

const GENERATION_PROMPT =
  "Create a compact weekly planning canvas with heading 'This week', a Notes textarea with id notes, and a working counter button with id counter and initial text 'Count 0'. Clicking the counter must increment its count without calling the model. Store count in data-count and write idempotent inline JavaScript. Use a small responsive two-column layout and a muted green accent. Stream separate HTML, CSS and script operations so the view appears before all updates finish. Do not inspect files or use tools.";
const LOCAL_NOTE = "Keep my local edits.";
const TIMEOUT_MS = 60_000;
const client = await desktopClient();
await showWorkspace(client, true);
let canvas: Awaited<ReturnType<typeof desktopClient>> | undefined;
const snapshot = () => client.evaluate<Snapshot>("window.astra.snapshot()");
const workspace = (state: Snapshot): Workspace => {
  const current = state.workspaces.find((entry) => entry.id === state.activeId);
  assert.ok(current);
  return current;
};
const waitUntil = async (check: (state: Snapshot) => boolean) => {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await snapshot();
    if (state.error || state.approval || state.status === "offline")
      throw new Error(
        JSON.stringify({
          error: state.error,
          approval: state.approval,
          status: state.status,
        }),
      );
    if (check(state)) return state;
    await Bun.sleep(100);
  }
  throw new Error("Desktop verification timed out.");
};
const submit = async (text: string) => {
  await client.evaluate('document.querySelector(".composer textarea").focus()');
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
  await client.evaluate("window.astra.newWorkspace()");
  await waitUntil((state) => workspace(state).messages.length === 0);
  await Bun.sleep(200);
  const pageOrigin = await client.evaluate("performance.timeOrigin");
  await submit(GENERATION_PROMPT);
  let progressive = false;
  const generated = await waitUntil((state) => {
    if (
      state.status === "working" &&
      (workspace(state).canvas?.revision ?? 0) > 0
    )
      progressive = true;
    return (
      state.status === "ready" &&
      Boolean(state.metrics?.total) &&
      workspace(state).canvas?.pending.length === 0
    );
  });
  assert.ok(
    progressive,
    "A real canvas must appear before generation finishes",
  );
  canvas = await desktopClient("canvas");
  const canvasOrigin = await canvas.evaluate("performance.timeOrigin");
  assert.deepEqual(
    await canvas.evaluate(
      `(() => {let parentBlocked=false;try{parent.document.body}catch{parentBlocked=true}return {parentBlocked,bridge:typeof window.astra,node:typeof process}})()`,
    ),
    { parentBlocked: true, bridge: "undefined", node: "undefined" },
  );
  await canvas.evaluate(
    'document.getElementById("counter").click(); document.getElementById("counter").click()',
  );
  assert.equal(
    await canvas.evaluate('document.getElementById("counter").textContent'),
    "Count 2",
  );
  await canvas.evaluate('document.getElementById("notes").focus()');
  await canvas.call("Input.insertText", { text: LOCAL_NOTE });
  await waitUntil(
    (state) => workspace(state).canvas?.html.includes(LOCAL_NOTE) === true,
  );
  assert.equal(
    workspace(await snapshot()).messages.length,
    workspace(generated).messages.length,
    "Local controls must not call the model",
  );
  await submit(
    "Change only the h1 text to 'My live workspace' in one surgical operation. Preserve Notes, the counter value, scripts and styling. Do not use tools.",
  );
  await waitUntil((state) => state.status === "working");
  const updated = await waitUntil(
    (state) =>
      state.status === "ready" && workspace(state).canvas?.pending.length === 0,
  );
  assert.equal(
    await canvas.evaluate('document.querySelector("h1").textContent'),
    "My live workspace",
  );
  assert.equal(
    await canvas.evaluate('document.getElementById("notes").value'),
    LOCAL_NOTE,
  );
  assert.equal(
    await canvas.evaluate('document.getElementById("counter").textContent'),
    "Count 2",
  );
  assert.equal(
    await canvas.evaluate("performance.timeOrigin"),
    canvasOrigin,
    "Canvas updates must not reload it",
  );
  assert.equal(
    await client.evaluate("performance.timeOrigin"),
    pageOrigin,
    "Generation must not reload the desktop",
  );
  const previousIndex = workspace(updated).canvas?.history.findIndex(
    (entry) =>
      entry.html.includes(LOCAL_NOTE) && entry.html.includes("This week"),
  );
  assert.ok(previousIndex !== undefined && previousIndex >= 0);
  await client.evaluate(
    `{const picker=document.querySelector('.version-picker');picker.value=${JSON.stringify(String(previousIndex))};picker.dispatchEvent(new Event('change',{bubbles:true}));}`,
  );
  await waitUntil(
    (state) =>
      workspace(state).canvas?.html.includes("My live workspace") === false,
  );
  await Bun.sleep(200);
  assert.equal(
    await canvas.evaluate('document.querySelector("h1").textContent'),
    "This week",
  );
  assert.equal(
    await canvas.evaluate('document.getElementById("notes").value'),
    LOCAL_NOTE,
  );
  canvas.close();
  canvas = undefined;
  await client.call("Page.reload");
  await Bun.sleep(500);
  canvas = await desktopClient("canvas");
  assert.equal(
    await canvas.evaluate('document.getElementById("notes").value'),
    LOCAL_NOTE,
  );
  assert.equal(
    await canvas.evaluate('document.getElementById("counter").textContent'),
    "Count 2",
  );
  await canvas.evaluate('document.getElementById("counter").click()');
  assert.equal(
    await canvas.evaluate('document.getElementById("counter").textContent'),
    "Count 3",
    "Generated controls must work after reopening",
  );
  await waitUntil(
    (state) => workspace(state).canvas?.html.includes("Count 3") === true,
  );
  await client.evaluate("window.astraFlush()");
  await Bun.sleep(400);
  const path = join(astraConfig().dataDirectory, "workspace.json");
  const saved = JSON.parse(readFileSync(path, "utf8"));
  assert.ok(workspace(saved).canvas?.html.includes(LOCAL_NOTE));
  assert.ok(workspace(saved).canvas?.html.includes("Count 3"));
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(client.errors.length, 0);
  assert.equal(canvas.errors.length, 0);
  await client.screenshot("test-results/substrate-verified.png");
  const result = {
    model: generated.model,
    backendVersion: generated.backendVersion,
    firstGeneration: generated.metrics,
    incrementalUpdate: updated.metrics,
    progressive,
    samePage: true,
    isolated: true,
    localEditsWithoutModel: true,
    statePreserved: true,
    restore: true,
    reopenedControls: true,
    persisted: true,
    rendererErrors: 0,
  };
  await Bun.write(
    "test-results/substrate-verification.json",
    JSON.stringify(result, null, 2),
  );
  console.log("DESKTOP_VERIFIED", JSON.stringify(result));
} finally {
  canvas?.close();
  client.close();
}
