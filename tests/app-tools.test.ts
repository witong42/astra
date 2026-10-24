import { expect, test } from "bun:test";
import type { AppControl } from "../src/app-control";
import {
  APP_TOOL,
  ASTRA_CONTROL_INSTRUCTIONS,
  ASTRA_INSTRUCTIONS,
} from "../src/app-tools";
import { CodexBackend } from "../src/backend";
import { newWorkspace } from "../src/storage";

function fixture(pauseVoice?: () => Promise<unknown>) {
  const workspace = newWorkspace("/tmp");
  const calls: AppControl[] = [];
  const backend: CodexBackend = new CodexBackend(
    {
      version: 1,
      activeId: workspace.id,
      model: "test",
      reasoningEffort: "low",
      serviceTier: "default",
      workspaces: [workspace],
    },
    () => {},
    () => {},
    async (request) => {
      calls.push(request);
      if (request.action === "open") backend.selectWorkspace(request.id);
      return request.action === "status"
        ? { screen: "home" }
        : { confirmed: request };
    },
    pauseVoice,
  );
  return { backend, workspace, calls };
}

test("astra advertises its real tool, CLI and navigation policy to both agent modes", () => {
  expect(APP_TOOL.name).toBe("astra");
  expect(APP_TOOL.description).toContain("instead of computer use");
  for (const instructions of [ASTRA_INSTRUCTIONS, ASTRA_CONTROL_INSTRUCTIONS]) {
    expect(instructions).toContain("~/.local/bin/astra");
    expect(instructions).toContain("astra status");
    expect(instructions).toContain("astra --help");
    expect(instructions).toContain("astra pause");
    expect(instructions).toContain("Do not use computer use");
    expect(instructions).toContain("Inspect controls first");
  }
});

test("pause uses the voice controller without navigating or changing app data", async () => {
  let pauses = 0;
  const { backend, calls } = fixture(async () => {
    pauses++;
    return { voice: "standby" };
  });
  const before = structuredClone(backend.state.workspaces);
  expect(await backend.appAction({ action: "pause" })).toEqual({
    voice: "standby",
  });
  expect(pauses).toBe(1);
  expect(calls).toEqual([]);
  expect(backend.state.workspaces).toEqual(before);
  expect(backend.state.journal?.at(-1)).toMatchObject({
    text: "Conversation en pause",
    status: "completed",
  });
  await expect(
    fixture().backend.appAction({ action: "pause" }),
  ).rejects.toThrow("Voice control is unavailable");
  const failed = fixture(async () => {
    throw new Error("Wake microphone unavailable");
  });
  await expect(failed.backend.appAction({ action: "pause" })).rejects.toThrow(
    "Wake microphone unavailable",
  );
  expect(failed.backend.state.journal?.at(-1)?.status).toBe("failed");
});

test("the same API provides status, confirmed navigation and targeted mini-app controls", async () => {
  const { backend, workspace, calls } = fixture();
  const original = structuredClone(workspace);
  expect(await backend.appAction({ action: "status" })).toMatchObject({
    app: "Astra",
    cli: "astra",
    interface: { screen: "home" },
  });
  await backend.appAction({ action: "home" });
  expect(
    await backend.appAction({ action: "open", id: workspace.id }),
  ).toMatchObject({ id: workspace.id, opened: true });
  for (const request of [
    { action: "inspect", id: workspace.id },
    { action: "click", id: workspace.id, selector: "#next" },
    { action: "fill", id: workspace.id, selector: "#title", value: "Lune" },
  ] as const) {
    expect(await backend.appAction(request)).toEqual({ confirmed: request });
  }
  expect(calls.map((call) => call.action)).toEqual([
    "status",
    "home",
    "open",
    "inspect",
    "click",
    "fill",
  ]);
  expect(workspace).toEqual(original);
});

test("invalid app actions are rejected before reaching the desktop", async () => {
  const { backend, workspace, calls } = fixture();
  for (const request of [
    { action: "exec", script: "whoami" },
    { action: "click", id: workspace.id },
    { action: "fill", id: workspace.id, selector: "#field" },
    { action: "open", id: crypto.randomUUID() },
  ])
    await expect(backend.appAction(request)).rejects.toThrow();
  expect(calls).toHaveLength(0);
});
