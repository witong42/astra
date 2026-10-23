import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Chat } from "../src/Chat";
import { newWorkspace } from "../src/storage";
import type { Snapshot } from "../src/types";

function snapshot(): Snapshot {
  const workspace = newWorkspace("/tmp/codexos-test");
  return {
    version: 1,
    activeId: workspace.id,
    workspaces: [workspace],
    model: "gpt-6.1-sol",
    reasoningEffort: "high",
    serviceTier: "priority",
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

const renderChat = (state: Snapshot) =>
  renderToStaticMarkup(
    <Chat
      snapshot={state}
      workspace={state.workspaces[0]}
      onError={(error) => {
        throw error;
      }}
    />,
  );

test("conversation renders untrusted messages as text and retains the pending activity", () => {
  const state = snapshot();
  state.status = "working";
  state.activity = "Searching the project";
  state.workspaces[0].messages = [
    { id: "user", role: "user", text: '<script>alert("hello")</script>' },
    { id: "assistant", role: "assistant", text: "" },
  ];
  const html = renderChat(state);
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("Searching the project");
  expect(html).not.toContain("What are we making?");
});

test("the empty conversation keeps approval questions and their answer controls accessible", () => {
  const state = snapshot();
  state.approval = {
    id: "question",
    kind: "question",
    summary: "Choose a direction",
    details: "",
    questions: [
      {
        id: "direction",
        header: "Direction",
        question: "Which approach?",
        options: [
          { label: "Keep it compact", description: "Use the existing layout" },
        ],
      },
    ],
  };
  const html = renderChat(state);
  expect(html).toContain("What are we making?");
  expect(html).toContain("Which approach?");
  expect(html).toContain("Keep it compact");
  expect(html).toContain('aria-label="Your answer: Direction"');
  expect(html).toContain("Send answer");
});
