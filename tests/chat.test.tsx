import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Journal } from "../src/JournalView";
import { initialJournal } from "../src/journal";
import { newWorkspace } from "../src/storage";
import type { Snapshot } from "../src/types";

function snapshot(): Snapshot {
  const workspace = newWorkspace("/tmp/codexos-test");
  return {
    sessions: {
      [workspace.id]: {
        busy: false,
        activity: "Ready",
        approval: null,
        error: null,
        metrics: null,
        settings: null,
      },
    },
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

const renderJournal = (state: Snapshot) =>
  renderToStaticMarkup(
    <Journal
      snapshot={{ ...state, journal: initialJournal(state) }}
      onClose={() => {}}
      onOpen={() => {}}
      onError={(error) => {
        throw error;
      }}
    />,
  );

test("the journal renders untrusted messages as text and retains its working indicator", () => {
  const state = snapshot();
  state.status = "working";
  state.activity = "Searching the project";
  state.sessions[state.activeId].busy = true;
  state.workspaces[0].messages = [
    { id: "user", role: "user", text: '<script>alert("hello")</script>' },
    { id: "assistant", role: "assistant", text: "" },
  ];
  const html = renderJournal(state);
  expect(html).toContain("&lt;script&gt;");
  expect(html).not.toContain("<script>");
  expect(html).toContain("Astra travaille…");
  expect(html).not.toContain("What are we making?");
});

test("the empty journal keeps approval questions and their answer controls accessible", () => {
  const state = snapshot();
  state.sessions[state.activeId].approval = {
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
  const html = renderJournal(state);
  expect(html).toContain("Le fil de ce qu’on fait ensemble.");
  expect(html).toContain("Which approach?");
  expect(html).toContain("Keep it compact");
  expect(html).toContain('aria-label="Your answer: Direction"');
  expect(html).toContain("Send answer");
});

test("the journal renders Markdown structure, GitHub tables and fenced code", () => {
  const state = snapshot();
  state.workspaces[0].messages = [
    {
      id: "markdown",
      role: "assistant",
      text: '# A useful answer\n\n**Bold** and *emphasis* with `inline code`.\n\n1. First\n2. Second\n\n- [x] Verified\n- [ ] Pending\n\n> A quotation\n\n| Name | Value |\n| --- | --- |\n| Speed | 2 |\n\n```ts\nconst value = "<safe>";\n```\n\n[Source](https://example.com/docs)',
    },
  ];
  const html = renderJournal(state);
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
  const html = renderJournal(state);
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
  const html = renderJournal(state);
  expect(html).toContain("<strong>bold</strong>");
  expect(html).toContain(
    '<pre><code class="language-js">const inProgress = 1;',
  );
});

test("the journal keeps voice, tool results and app links in their recorded order", () => {
  const state = snapshot();
  const app = state.workspaces[0];
  app.name = "Inner Atlas";
  state.journal = [
    {
      id: "voice",
      at: 0,
      kind: "user",
      source: "voice",
      text: "Ouvre Inner Atlas",
    },
    {
      id: "action",
      at: 0,
      kind: "action",
      source: "tool",
      text: "Mini-app ouverte",
      detail: "Ouverture confirmée",
      status: "completed",
      workspaceId: app.id,
    },
    {
      id: "reply",
      at: 0,
      kind: "assistant",
      source: "voice",
      text: "Ton espace est prêt.",
    },
  ];
  const html = renderJournal(state);
  expect(html.indexOf("Ouvre Inner Atlas")).toBeLessThan(
    html.indexOf("Mini-app ouverte"),
  );
  expect(html.indexOf("Mini-app ouverte")).toBeLessThan(
    html.indexOf("Ton espace est prêt."),
  );
  expect(html).toContain("· voix");
  expect(html).toContain("Ouverture confirmée");
  expect(html).toContain("Effectuée");
  expect(html).toContain('class="journal-app">Inner Atlas</button>');
});
