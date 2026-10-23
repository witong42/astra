import assert from "node:assert/strict";
import { join } from "node:path";
import { emptyCanvas } from "../src/canvas";
import { loadState, newWorkspace, saveState } from "../src/storage";
import type { Snapshot } from "../src/types";
import { desktopClient } from "./desktop-client";

const PROFILE = "/tmp/codexos-workspaces-check";
const ROOT = join(import.meta.dir, "..");
const DELETE_MARKER = "workspace-deletion-fixture-secret";
if (process.argv.includes("--prepare")) {
  const settings = loadState(
    join(
      process.env.HOME ?? "",
      "Library/Application Support/CodexOS/workspace.json",
    ),
    ROOT,
  );
  const workspaces = [
    "Create an orbit dashboard with interactive controls",
    "i wanna listen to music",
    "Create a dashboard about me and my life",
    "i need an app that does presentations",
    "a text based adventure with choices",
    "Delete Probe",
  ].map((name) => {
    const workspace = newWorkspace(ROOT);
    workspace.name = name;
    workspace.favorite = true;
    workspace.canvas = emptyCanvas();
    workspace.canvas.generation = 1;
    workspace.canvas.html = `<main id="substrate"><h1>${name === "Delete Probe" ? DELETE_MARKER : "Your app"}</h1><input value="Saved input"></main>`;
    workspace.canvas.history = [
      {
        html: `<main id="substrate">${name === "Delete Probe" ? DELETE_MARKER : "Previous version"}</main>`,
        css: "",
        generation: 0,
      },
    ];
    return workspace;
  });
  workspaces.at(-1)?.messages.push({
    id: crypto.randomUUID(),
    role: "user",
    text: DELETE_MARKER,
  });
  saveState(join(PROFILE, "workspace.json"), {
    version: 1,
    model: settings.model,
    reasoningEffort: settings.reasoningEffort,
    serviceTier: settings.serviceTier,
    activeId: workspaces[0].id,
    workspaces,
  });
  console.log("WORKSPACE_PROFILE_PREPARED", PROFILE);
  process.exit(0);
}
const client = await desktopClient();
const snapshot = () => client.evaluate<Snapshot>("window.codexos.snapshot()");
async function wait<T>(
  read: () => Promise<T>,
  check: (value: T) => boolean,
  description: string,
) {
  for (let attempt = 0; attempt < 400; attempt++) {
    const value = await read();
    if (check(value)) return value;
    await Bun.sleep(50);
  }
  throw new Error(`Timed out waiting for ${description}`);
}
const click = async (selector: string) => {
  await wait(
    () =>
      client.evaluate(`!!document.querySelector(${JSON.stringify(selector)})`),
    Boolean,
    `element ${selector}`,
  );
  await client.evaluate(
    `document.querySelector(${JSON.stringify(selector)}).click()`,
  );
};
try {
  const state = await wait(
    snapshot,
    (s) => s.status === "ready",
    "Codex connection",
  );
  await client.evaluate("document.querySelector('.home-button')?.click()");
  await wait(
    () => client.evaluate("!!document.querySelector('.home-screen')"),
    Boolean,
    "Home launcher",
  );
  const orbit = state.workspaces.find((w) => w.name === "Orbit Lab");
  const target = state.workspaces.find((w) => w.name === "Delete Probe");
  assert.ok(orbit && target);
  assert.ok(state.workspaces.every((w) => w.name.split(/\s+/).length <= 2));
  await client.screenshot("test-results/workspace-icons-wide.png");
  await click(
    `.library-row:has([data-workspace-id="${orbit.id}"]) .workspace-menu-trigger`,
  );
  await click(".workspace-menu:popover-open .workspace-menu-item");
  await wait(
    () => client.evaluate("document.activeElement?.className"),
    (s) => s === "workspace-name-input",
    "rename focus",
  );
  await client.evaluate(
    `(()=>{const input=document.querySelector('.workspace-menu:popover-open input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'An invalid long title');input.dispatchEvent(new Event('input',{bubbles:true}))})()`,
  );
  await client.evaluate(
    "document.querySelector('.workspace-menu:popover-open form').requestSubmit()",
  );
  await wait(
    () =>
      client.evaluate(
        "document.querySelector('.workspace-menu:popover-open [role=alert]')?.textContent",
      ),
    (s) => !!s,
    "name validation",
  );
  assert.equal(
    (await snapshot()).workspaces.find((w) => w.id === orbit.id)?.name,
    "Orbit Lab",
  );
  await client.evaluate(
    `(()=>{const input=document.querySelector('.workspace-menu:popover-open input');const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(input,'Star Atlas');input.dispatchEvent(new Event('input',{bubbles:true}))})()`,
  );
  await client.evaluate(
    "document.querySelector('.workspace-menu:popover-open form').requestSubmit()",
  );
  await wait(
    snapshot,
    (s) => s.workspaces.find((w) => w.id === orbit.id)?.name === "Star Atlas",
    "rename save",
  );
  await wait(
    () => client.evaluate("document.querySelectorAll(':popover-open').length"),
    (n) => n === 0,
    "rename close",
  );
  await click(`.library-open[data-workspace-id="${target.id}"]`);
  await wait(
    () => client.evaluate("document.querySelector('.home-screen')===null"),
    Boolean,
    "target open",
  );
  await click(".desktop-navigation .workspace-menu-trigger");
  await click(".workspace-menu:popover-open .destructive");
  await wait(
    () =>
      client.evaluate(
        "document.querySelector('.workspace-menu:popover-open .destructive')?.textContent",
      ),
    (s) => s === "Deleting…",
    "pending cancel dialog",
  );
  console.log("DELETE_CANCEL_DIALOG_READY");
  await wait(
    () => client.evaluate("document.querySelectorAll(':popover-open').length"),
    (n) => n === 0,
    "native cancellation",
  );
  assert.ok((await snapshot()).workspaces.some((w) => w.id === target.id));
  await click(".desktop-navigation .workspace-menu-trigger");
  await click(".workspace-menu:popover-open .destructive");
  console.log("DELETE_CONFIRM_DIALOG_READY");
  await wait(
    snapshot,
    (s) => !s.workspaces.some((w) => w.id === target.id),
    "native deletion confirmation",
  );
  await wait(
    () => client.evaluate("!!document.querySelector('.home-screen')"),
    Boolean,
    "Home after active app deletion",
  );
  const disk = loadState(join(PROFILE, "workspace.json"), ROOT);
  assert.ok(!disk.workspaces.some((w) => w.id === target.id));
  assert.ok(!JSON.stringify(disk.workspaces).includes(target.id));
  assert.ok(!JSON.stringify(disk).includes(DELETE_MARKER));
  assert.equal(
    disk.workspaces.find((w) => w.id === orbit.id)?.name,
    "Star Atlas",
  );
  assert.equal(disk.workspaces.length, state.workspaces.length - 1);
  await client.call("Page.reload");
  await wait(
    () => client.evaluate("document.querySelectorAll('.library-row').length"),
    (n) => n === disk.workspaces.length,
    "persisted deletion after reload",
  );
  const after = await snapshot();
  assert.equal(after.model, state.model);
  assert.equal(after.reasoningEffort, state.reasoningEffort);
  assert.equal(after.serviceTier, state.serviceTier);
  await client.screenshot("test-results/workspaces-final.png");
  assert.equal(client.errors.length, 0, JSON.stringify(client.errors));
  console.log(
    "WORKSPACES_VERIFIED",
    JSON.stringify({
      shortNames: true,
      renameValidation: true,
      renamePersists: true,
      nativeCancelPreservesData: true,
      confirmedDeletionPersists: true,
      returnsHome: true,
      otherAppsPreserved: true,
      settingsUnchanged: true,
      errors: 0,
    }),
  );
} finally {
  client.close();
}
