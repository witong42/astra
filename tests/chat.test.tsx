import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Chat } from "../src/Chat";
import { newWorkspace } from "../src/storage";
import type { Snapshot } from "../src/types";

function snapshot(): Snapshot {
  const workspace = newWorkspace("/tmp/codexos-test");
  return {
    sessions: {},
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

test("chat renders Markdown structure, GitHub tables and fenced code", () => {
  const state = snapshot();
  state.workspaces[0].messages = [
    {
      id: "markdown",
      role: "assistant",
      text: '# A useful answer\n\n**Bold** and *emphasis* with `inline code`.\n\n1. First\n2. Second\n\n- [x] Verified\n- [ ] Pending\n\n> A quotation\n\n| Name | Value |\n| --- | --- |\n| Speed | 2 |\n\n```ts\nconst value = "<safe>";\n```\n\n[Source](https://example.com/docs)',
    },
  ];
  const html = renderChat(state);
  expect(html).toContain("<h1>A useful answer</h1>");
  expect(html).toContain("<strong>Bold</strong>");
  expect(html).toContain("<em>emphasis</em>");
  expect(html).toContain("<code>inline code</code>");
  expect(html).toContain("<ol>");
  expect(html).toContain("<blockquote>");
  expect(html).toContain("<table>");
  expect(html).toContain("<th>Name</th>");
  expect(html).toContain('type="checkbox" disabled="" checked=""');
  expect(html).toContain('<pre><code class="language-ts">');
  expect(html).toContain("&lt;safe&gt;");
  expect(html).toContain('href="https://example.com/docs"');
});

test("Markdown never executes HTML, opens unsafe URLs or fetches inline images", () => {
  const state = snapshot();
  state.workspaces[0].messages = [
    {
      id: "untrusted",
      role: "assistant",
      text: '<script>alert(1)</script>\n\n<img src="x" onerror="alert(2)">\n\n[Bad](javascript:alert%281%29) [Local](file:///etc/passwd) [Data](data:text/html,hello) [Credentials](https://user:password@example.com/)\n\n![Diagram](https://example.com/diagram.png)',
    },
  ];
  const html = renderChat(state);
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<img ");
  expect(html).not.toContain('href="javascript:');
  expect(html).not.toContain('href="file:');
  expect(html).not.toContain('href="data:');
  expect(html).not.toContain('href="https://user:password');
  expect(html).toContain("Diagram");
});

test("partial Markdown fences remain readable as the assistant streams", () => {
  const state = snapshot();
  state.status = "working";
  state.workspaces[0].messages = [
    {
      id: "streaming",
      role: "assistant",
      text: "Working with **bold**.\n\n```js\nconst inProgress = 1;",
    },
  ];
  const html = renderChat(state);
  expect(html).toContain("<strong>bold</strong>");
  expect(html).toContain(
    '<pre><code class="language-js">const inProgress = 1;',
  );
});
