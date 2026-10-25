import assert from "node:assert/strict";
import type { Snapshot, Workspace } from "../src/types";
import { desktopClient, showWorkspace } from "./desktop-client";

const TIMEOUT_MS = 180_000;
const POLL_MS = 100;
const client = await desktopClient();
const snapshot = () => client.evaluate<Snapshot>("window.astra.snapshot()");
const workspace = (state: Snapshot, id = state.activeId): Workspace => {
  const found = state.workspaces.find((entry) => entry.id === id);
  assert.ok(found);
  return found;
};
async function waitFor(
  check: (state: Snapshot) => boolean,
  description: string,
) {
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await snapshot();
    if (
      state.status === "offline" ||
      state.error ||
      Object.values(state.sessions).some(
        (session) => session.error || session.approval,
      )
    )
      throw new Error(
        JSON.stringify({
          description,
          status: state.status,
          error: state.error,
          sessions: state.sessions,
        }),
      );
    if (check(state)) return state;
    await Bun.sleep(POLL_MS);
  }
  throw new Error(`Session verification timed out: ${description}`);
}
async function goHome() {
  await client.evaluate("document.querySelector('.home-button')?.click()");
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      await client.evaluate("Boolean(document.querySelector('.home-screen'))")
    )
      return;
    await Bun.sleep(50);
  }
  throw new Error("Home did not open");
}
async function createWorkspace() {
  const previous = (await snapshot()).activeId;
  await goHome();
  await client.evaluate(
    "if(document.querySelector('.chat-drawer').inert) document.getElementById('chat-toggle').click()",
  );
  assert.equal(
    await client.evaluate(
      "document.querySelector('.journal-tools [aria-label=\"Créer une mini-app\"]').disabled",
    ),
    false,
  );
  await client.evaluate(
    "document.querySelector('.journal-tools [aria-label=\"Créer une mini-app\"]').click()",
  );
  const state = await waitFor(
    (state) => state.activeId !== previous,
    "new workspace",
  );
  await showWorkspace(client, true);
  return state.activeId;
}
async function select(id: string) {
  await goHome();
  await client.evaluate(
    `document.querySelector('.library-open[data-workspace-id="${id}"]').click()`,
  );
  await waitFor((state) => state.activeId === id, "workspace selection");
  await showWorkspace(client, true);
}
async function draft(text: string) {
  await client.evaluate(
    "{const input=document.querySelector('.composer textarea');input.focus();input.select()}",
  );
  await client.call("Input.insertText", { text });
}
async function send(text: string) {
  await draft(text);
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
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (
      await client.evaluate(
        "document.querySelector('.composer textarea').value === ''",
      )
    )
      return;
    await Bun.sleep(POLL_MS);
  }
  throw new Error("The submitted message was not acknowledged by the composer");
}
const PROMPT =
  "Create a tiny canvas with a heading #probe-title containing '%TITLE%', a button #probe-counter with text 'Count 0', and a textarea #probe-note labeled Notes. Add working inline JavaScript: each click increments and persists data-count plus visible text. Use private DOM properties for listener guards, never data-bound attributes. Use no more than three substrate operations. No tools or file edits. Keep prose brief.";
try {
  const initial = await waitFor(
    (state) => state.status === "ready",
    "connection",
  );
  const origin = await client.evaluate("performance.timeOrigin");
  const a = await createWorkspace();
  await draft("Unsent draft in workspace A");
  const b = await createWorkspace();
  await draft("Unsent draft in workspace B");
  await select(a);
  assert.equal(
    await client.evaluate("document.querySelector('.composer textarea').value"),
    "Unsent draft in workspace A",
  );
  await send(PROMPT.replace("%TITLE%", "Session A"));
  await waitFor((state) => state.sessions[a]?.busy, "A started");
  assert.equal(
    await client.evaluate(
      "document.querySelector('button[aria-label=\"Stop Codex\"]') !== null && document.querySelector('button[aria-label=\"Send guidance\"]') !== null",
    ),
    true,
  );
  assert.equal(
    await client.evaluate(
      "[...document.querySelectorAll('.home-button')].some(button=>button.disabled)",
    ),
    false,
  );
  await send(
    "Change #probe-title to 'A steered'. Include a short paragraph #probe-guidance with text 'Steering accepted'. Keep the counter and notes working. No tools.",
  );
  await select(b);
  assert.equal(
    await client.evaluate("document.querySelector('.composer textarea').value"),
    "Unsent draft in workspace B",
  );
  await send(PROMPT.replace("%TITLE%", "Session B"));
  await waitFor(
    (state) => state.sessions[a]?.busy && state.sessions[b]?.busy,
    "simultaneous turns",
  );
  console.log("CONCURRENT_TURNS_AND_STEERING_ACCEPTED");
  assert.equal(
    await client.evaluate("document.querySelectorAll('.canvas-frame').length"),
    2,
  );
  const background = await desktopClient("canvas", a);
  const geometry = await background.evaluate<{ width: number; height: number }>(
    "({width:innerWidth,height:innerHeight})",
  );
  assert.ok(
    geometry.width > 0 && geometry.height > 0,
    "Background canvases must retain usable layout dimensions",
  );
  background.close();
  const completed = await waitFor(
    (state) =>
      !state.sessions[a]?.busy &&
      !state.sessions[b]?.busy &&
      workspace(state, a).canvas?.pending.length === 0 &&
      workspace(state, b).canvas?.pending.length === 0,
    "both canvases saved",
  );
  assert.ok(workspace(completed, a).canvas?.html.includes("A steered"));
  assert.ok(workspace(completed, a).canvas?.html.includes("Steering accepted"));
  assert.ok(workspace(completed, b).canvas?.html.includes("Session B"));
  assert.ok(!workspace(completed, b).canvas?.html.includes("A steered"));
  assert.equal(
    await client.evaluate("performance.timeOrigin"),
    origin,
    "Generation and switching must not reload the app",
  );
  await select(a);
  const canvas = await desktopClient("canvas", a);
  await canvas.evaluate(
    "{document.getElementById('probe-counter').click();const note=document.getElementById('probe-note');note.value='Notes survive switching';note.dispatchEvent(new Event('input',{bubbles:true}))}",
  );
  await client.evaluate("window.astraFlush()");
  const counter = await canvas.evaluate<string>(
    "document.getElementById('probe-counter').textContent",
  );
  assert.match(counter, /1/);
  canvas.close();
  await select(b);
  await select(a);
  const restored = await desktopClient("canvas", a);
  assert.equal(
    await restored.evaluate("document.getElementById('probe-note').value"),
    "Notes survive switching",
  );
  assert.equal(
    await restored.evaluate(
      "document.getElementById('probe-counter').textContent",
    ),
    counter,
  );
  await restored.evaluate("document.getElementById('probe-counter').click()");
  assert.match(
    await restored.evaluate<string>(
      "document.getElementById('probe-counter').textContent",
    ),
    /2/,
  );
  restored.close();
  await client.evaluate("window.astraFlush()");
  await client.screenshot("test-results/concurrent-sessions.png");
  assert.equal(client.errors.length, 0);
  const final = await snapshot();
  assert.equal(final.model, initial.model);
  assert.equal(final.reasoningEffort, initial.reasoningEffort);
  assert.equal(final.serviceTier, initial.serviceTier);
  console.log(
    "SESSIONS_VERIFIED",
    JSON.stringify({
      parallelTurns: true,
      steering: true,
      backgroundCanvasSaved: true,
      draftsPreserved: true,
      counterRestored: true,
      modelSettingsUnchanged: true,
      errors: 0,
    }),
  );
} finally {
  client.close();
}
