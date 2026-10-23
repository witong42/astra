import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HomeScreen } from "../src/HomeScreen";
import { newWorkspace } from "../src/storage";
import type { Snapshot } from "../src/types";

function state(): Snapshot {
  const app = newWorkspace("/tmp");
  app.name = "Orbit lab";
  if (app.canvas) app.canvas.generation = 1;
  const blank = newWorkspace("/tmp");
  return {
    version: 1,
    activeId: app.id,
    model: "gpt-6.1-sol",
    reasoningEffort: "high",
    serviceTier: "priority",
    workspaces: [app, blank],
    sessions: {},
    status: "ready",
    activity: "Ready",
    account: "",
    backendVersion: "",
    models: [],
    approval: null,
    error: null,
    metrics: null,
  };
}
const render = (snapshot: Snapshot) =>
  renderToStaticMarkup(
    <HomeScreen
      snapshot={snapshot}
      onOpen={() => {}}
      onFavorite={() => {}}
      onRename={async () => {}}
      onDelete={async () => {}}
    />,
  );
test("Home exposes all workspaces and explains how to add an app when favorites are empty", () => {
  const html = render(state());
  expect(html).toContain("Keep a canvas here.");
  expect(html).toContain("All workspaces");
  expect(html).toContain("Orbit lab");
  expect(html).not.toContain('class="app-tile"');
  expect(html).toContain('title="Create a canvas first"');
  expect(html).toContain('disabled=""');
});
test("favorites launch as app tiles while sessions needing input remain visible", () => {
  const snapshot = state();
  const app = snapshot.workspaces[0];
  app.favorite = true;
  snapshot.sessions[app.id] = {
    busy: true,
    activity: "Waiting for you",
    approval: {
      id: "approval",
      kind: "command",
      summary: "Review",
      details: "",
    },
    error: null,
    metrics: null,
    settings: null,
  };
  const html = render(snapshot);
  expect(html).toContain('class="app-tile"');
  expect(html).toContain('aria-label="Open Orbit lab"');
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain("Needs you");
});
