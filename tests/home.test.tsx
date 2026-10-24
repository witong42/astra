import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Astra } from "../src/Astra";
import { HomeScreen } from "../src/HomeScreen";
import { newWorkspace } from "../src/storage";
import type { Snapshot } from "../src/types";
import { INITIAL_VOICE, type VoiceState } from "../src/voice";

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
      onFavorite={async () => {}}
      onRename={async () => {}}
      onDelete={async () => {}}
    />,
  );
test("the resting galaxy has no instructional labels", () => {
  const html = renderToStaticMarkup(<Astra />);
  expect(html).not.toContain("Click to meet Astra");
  expect(html).not.toContain("Click once to enable voice");
  expect(html).toContain("Micro désactivé");
  expect(html).toContain('aria-label="Activer la voix d’Astra"');
});
test("the galaxy labels distinguish pausing a live call, waking standby and enabling voice", () => {
  for (const [status, active, label, pressed] of [
    ["speaking", true, "Mettre Astra en veille", true],
    ["listening", true, "Mettre Astra en veille", true],
    ["standby", true, "Parler à Astra", false],
    ["off", false, "Activer la voix d’Astra", false],
    ["error", false, "Activer la voix d’Astra", false],
  ] as const) {
    const html = renderToStaticMarkup(
      <Astra voice={{ ...INITIAL_VOICE, status, active }} />,
    );
    expect(html).toContain(`aria-label="${label}"`);
    expect(html).toContain(`aria-pressed="${pressed}"`);
  }
});
test("Horizon exposes every app without requiring favorites or adding a second library", () => {
  const html = render(state());
  expect(html).toContain('data-layout="horizon"');
  expect(html).toContain("Orbit lab");
  expect(html.match(/class="library-open app-tile"/g)).toHaveLength(2);
  expect(html).not.toContain("home-library-toggle");
  expect(html).not.toContain("Your apps");
});
test("favorites appear first with a visible marker without changing stored app order", () => {
  const snapshot = state();
  const favorite = newWorkspace("/tmp");
  favorite.name = "Favorite studio";
  favorite.favorite = true;
  if (favorite.canvas) favorite.canvas.generation = 1;
  snapshot.workspaces.push(favorite);
  const originalOrder = snapshot.workspaces.map((workspace) => workspace.id);

  const html = render(snapshot);
  expect(html.indexOf('aria-label="Ouvrir Favorite studio"')).toBeLessThan(
    html.indexOf('aria-label="Ouvrir Orbit lab"'),
  );
  expect(html).toContain('aria-description="Favori"');
  expect(html.match(/class="home-favorite-star"/g)).toHaveLength(1);
  expect(html.match(/class="library-open app-tile"/g)).toHaveLength(3);
  expect(snapshot.workspaces.map((workspace) => workspace.id)).toEqual(
    originalOrder,
  );

  favorite.favorite = false;
  const unpinned = render(snapshot);
  expect(unpinned.indexOf('aria-label="Ouvrir Orbit lab"')).toBeLessThan(
    unpinned.indexOf('aria-label="Ouvrir Favorite studio"'),
  );
  expect(unpinned).not.toContain('class="home-favorite-star"');
  expect(unpinned).not.toContain('aria-description="Favori"');
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
  expect(html).toContain('class="library-open app-tile"');
  expect(html).toContain('aria-label="Ouvrir Orbit lab"');
  expect(html).toContain("Retirer des favoris");
  expect(html).toContain("À confirmer");
});

test("a large collection displays six apps with favorites first and carousel navigation", () => {
  const snapshot = state();
  snapshot.workspaces = Array.from({ length: 25 }, (_, index) => ({
    ...newWorkspace("/tmp"),
    name: `Studio ${String(index + 1).padStart(2, "0")}`,
    favorite: index === 24,
  }));
  const html = render(snapshot);
  expect(html.match(/class="library-open app-tile"/g)).toHaveLength(6);
  expect(html).toContain('aria-roledescription="carrousel"');
  expect(html).toContain('aria-label="Mini-apps précédentes"');
  expect(html).toContain('aria-label="Mini-apps suivantes"');
  expect(html).toContain('aria-label="Ouvrir Studio 25"');
  expect(html).toContain('aria-label="Ouvrir Studio 05"');
  expect(html).not.toContain('aria-label="Ouvrir Studio 06"');
  expect(html).toContain("1 / 25");
  expect(html).toContain("Défilez à la molette");
});

test("carousel navigation is available even with six apps, but not an empty or single app", () => {
  for (const count of [0, 1, 6]) {
    const snapshot = state();
    snapshot.workspaces = Array.from({ length: count }, () =>
      newWorkspace("/tmp"),
    );
    const html = render(snapshot);
    expect(html.match(/class="library-open app-tile"/g) ?? []).toHaveLength(
      count,
    );
    expect(html.includes('aria-label="Mini-apps suivantes"')).toBe(count > 1);
  }
});

test("a discreet Astra remains available in an app even with voice disabled", () => {
  const html = renderToStaticMarkup(<Astra compact onToggle={() => {}} />);
  expect(html).toContain('aria-label="Retour à l’accueil"');
  expect(html).toContain("astra-home-orb");
  expect(html).not.toContain("astra-task");
  expect(html).not.toContain('disabled=""');
  expect(html).toContain("<canvas");
  expect(html).not.toContain("<img");
});

test("the mini-app orb exposes voice state while remaining a Home button", () => {
  for (const [status, label] of [
    ["listening", "À ton écoute"],
    ["speaking", "Astra répond"],
    ["standby", "En veille"],
  ] as const) {
    const html = renderToStaticMarkup(
      <Astra compact voice={{ ...INITIAL_VOICE, status, active: true }} />,
    );
    expect(html).toContain(`voice-${status}`);
    expect(html).toContain(`aria-description="${label}"`);
    expect(html).toContain('aria-label="Retour à l’accueil"');
    expect(html).not.toContain('disabled=""');
  }
});

test("the halo bounds live audio levels and ignores stale levels outside conversation", () => {
  const renderLevel = (status: VoiceState["status"], level: number) =>
    renderToStaticMarkup(
      <Astra compact voice={{ ...INITIAL_VOICE, status, level }} />,
    );
  for (const status of ["listening", "speaking"] as const) {
    for (const [level, expected] of [
      [0.65, 0.65],
      [-1, 0],
      [2, 1],
      [Number.NaN, 0],
      [Number.POSITIVE_INFINITY, 0],
    ])
      expect(renderLevel(status, level)).toContain(
        `--astra-voice-level:${expected}`,
      );
  }
  for (const status of [
    "off",
    "standby",
    "starting",
    "thinking",
    "error",
  ] as const)
    expect(renderLevel(status, 1)).toContain("--astra-voice-level:0");
});

test("Astra gives mini-apps distinct Solar icons instead of treating every Atlas as a planet", () => {
  const snapshot = state();
  snapshot.workspaces = [
    "Memory Atlas",
    "Inner Atlas",
    "Chinese Studio",
    "Personal Wiki",
    "Spotify Studio",
    "Decision Lab",
  ].map((name) => ({ ...newWorkspace("/tmp"), name, favorite: true }));
  const html = render(snapshot);
  for (const icon of [
    "brain",
    "compass",
    "global",
    "notebook",
    "soundwave",
    "branching-paths-up",
  ])
    expect(html).toContain(`solar-${icon}-line-duotone`);
  expect(html).not.toContain("solar-planet-line-duotone");
});
