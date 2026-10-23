import { expect, test } from "bun:test";
import {
  appendFileSync,
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexBackend } from "../src/backend";
import type { RpcMessage } from "../src/rpc";
import { loadState, newWorkspace } from "../src/storage";
import type { SavedState } from "../src/types";

const POLL_INTERVAL_MS = 10;
const POLL_ATTEMPTS = 200;

async function waitFor(check: () => boolean, description: string) {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    if (check()) return;
    await Bun.sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for ${description}`);
}

async function withBackend(
  check: (fixture: Awaited<ReturnType<typeof startBackend>>) => Promise<void>,
) {
  const previousExecutable = process.env.CODEXOS_CODEX_PATH;
  const fixture = await startBackend();
  try {
    await fixture.backend.connect();
    await check(fixture);
  } finally {
    await fixture.backend.stop();
    if (previousExecutable === undefined) delete process.env.CODEXOS_CODEX_PATH;
    else process.env.CODEXOS_CODEX_PATH = previousExecutable;
    rmSync(fixture.directory, { recursive: true });
  }
}

async function startBackend() {
  const directory = mkdtempSync(join(tmpdir(), "codexos-sessions-test-"));
  const executable = join(directory, "fake-codex");
  const commandsPath = join(directory, "commands.jsonl");
  const wirePath = join(directory, "wire.jsonl");
  writeFileSync(commandsPath, "");
  writeFileSync(wirePath, "");
  writeFileSync(
    executable,
    `#!/usr/bin/env bun
import { appendFileSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
if (process.argv.includes('--version')) { console.log('codex-cli test'); process.exit(0); }
const commandsPath = ${JSON.stringify(commandsPath)};
const wirePath = ${JSON.stringify(wirePath)};
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
const record = value => appendFileSync(wirePath, JSON.stringify(value) + '\\n');
const turns = new Map();
const pendingStarts = [];
let holdStarts = false;
let threadSequence = 0;
let commandsRead = 0;
let rejectDeletes = false;
let holdDeletes = false;
let alreadyDeleted = false;
const pendingDeletes = [];
const complete = (threadId, status = 'completed') => send({method:'turn/completed', params:{threadId, turn:{id:turns.get(threadId),status}}});
createInterface({input:process.stdin}).on('line', line => {
  const message = JSON.parse(line);
  record(message);
  const { id, method, params = {} } = message;
  if (method === 'initialize') send({id,result:{}});
  if (method === 'account/read') send({id,result:{account:{type:'chatgpt',planType:'test'}}});
  if (method === 'model/list') send({id,result:{data:[{id:'test',model:'test',displayName:'Test',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}],serviceTiers:[]}]}});
  if (method === 'config/read') send({id,result:{config:{model:'test'}}});
  if (method === 'thread/start') send({id,result:{thread:{id:'thread-'+ ++threadSequence}}});
  if (method === 'thread/resume') send({id,result:{thread:{id:params.threadId}}});
  if (method === 'thread/delete') {
    if(alreadyDeleted) send({id,error:{code:-32000,message:'no rollout found for thread id '+params.threadId}});
    else if(rejectDeletes) send({id,error:{code:-32000,message:'Thread cleanup failed'}});
    else if(holdDeletes) pendingDeletes.push(id);
    else send({id,result:{}});
  }
  if (method === 'thread/read') {
    if(alreadyDeleted) send({id,error:{code:-32000,message:'no rollout found for thread id '+params.threadId}});
    else send({id,result:{thread:{id:params.threadId}}});
  }
  if (method === 'turn/start') {
    const turnId = 'turn-' + params.threadId + '-' + id;
    turns.set(params.threadId, turnId);
    const response = {id,result:{turn:{id:turnId}}};
    if (holdStarts) pendingStarts.push({response,threadId:params.threadId});
    else send(response);
  }
  if (method === 'turn/steer') {
    const text = params.input?.[0]?.text ?? '';
    if (text.startsWith('race steer')) {
      complete(params.threadId);
      send({id,error:{code:-32000,message:'Turn already completed'}});
    } else if (text.startsWith('reject steer')) {
      send({id,error:{code:-32000,message:'Steering rejected by fake server'}});
    } else {
      send({id,result:{turnId:turns.get(params.threadId)}});
    }
  }
  if (method === 'turn/interrupt') {
    send({id,result:{}});
    complete(params.threadId, 'interrupted');
  }
});
setInterval(() => {
  const lines = readFileSync(commandsPath, 'utf8').split('\\n').filter(Boolean);
  while (commandsRead < lines.length) {
    const command = JSON.parse(lines[commandsRead++]);
    record({controlId:command.controlId});
    if (command.kind === 'hold-starts') holdStarts = true;
    if (command.kind === 'reject-deletes') rejectDeletes = command.value;
    if (command.kind === 'already-deleted') alreadyDeleted = true;
    if (command.kind === 'hold-deletes') holdDeletes = true;
    if (command.kind === 'release-deletes') { holdDeletes=false; for(const id of pendingDeletes.splice(0)) send({id,result:{}}); }
    if (command.kind === 'release-starts') {
      holdStarts = false;
      for (const pending of pendingStarts.splice(0)) {
        if (command.completeFirst) complete(pending.threadId);
        send(pending.response);
      }
    }
    if (command.kind === 'event') send(command.message);
    if (command.kind === 'complete') complete(command.threadId);
    if (command.kind === 'disconnect') process.exit(0);
  }
}, ${POLL_INTERVAL_MS});
`,
  );
  chmodSync(executable, 0o700);
  process.env.CODEXOS_CODEX_PATH = executable;
  const saved = loadState(join(directory, "state.json"), directory);
  const a = saved.activeId;
  const second = newWorkspace(directory);
  saved.workspaces.push(second);
  const b = second.id;
  const persisted: SavedState[] = [];
  let failImmediatePersist = false;
  const backend = new CodexBackend(
    saved,
    () => {},
    (state, immediate) => {
      if (immediate && failImmediatePersist) throw new Error("Disk is full");
      persisted.push(structuredClone(state));
    },
  );
  const readWire = () =>
    readFileSync(wirePath, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as RpcMessage & { controlId?: string });
  const requests = (method: string) =>
    readWire().filter((message) => message.method === method);
  const workspace = (id: string) => {
    const result = backend.state.workspaces.find((entry) => entry.id === id);
    if (!result) throw new Error(`Missing test workspace ${id}`);
    return result;
  };
  const session = (id: string) => backend.snapshot().sessions[id];
  const command = async (value: Record<string, unknown>) => {
    const controlId = crypto.randomUUID();
    appendFileSync(
      commandsPath,
      `${JSON.stringify({ ...value, controlId })}\n`,
    );
    await waitFor(
      () => readWire().some((message) => message.controlId === controlId),
      "fake server to consume command",
    );
  };
  const event = (message: RpcMessage) => command({ kind: "event", message });
  return {
    backend,
    directory,
    a,
    b,
    requests,
    readWire,
    workspace,
    session,
    command,
    event,
    persisted,
    failPersistence: (fail: boolean) => {
      failImmediatePersist = fail;
    },
  };
}

test("creating and switching workspaces stays available while another session runs", () =>
  withBackend(async ({ backend, a, b, session }) => {
    await backend.send("Keep working in A", a);
    backend.selectWorkspace(b);
    expect(backend.state.activeId).toBe(b);
    expect(backend.state.status).toBe("ready");
    backend.createWorkspace();
    expect(backend.state.workspaces).toHaveLength(3);
    expect(backend.state.activeId).not.toBe(a);
    expect(session(a).busy).toBe(true);
    backend.selectWorkspace(a);
    expect(backend.state.status).toBe("working");
  }));

test("two workspaces can run independently without sharing turn state", () =>
  withBackend(async ({ backend, a, b, session, requests, workspace }) => {
    await backend.send("Work in A", a);
    await backend.send("Work in B", b);
    expect(session(a).busy).toBe(true);
    expect(session(b).busy).toBe(true);
    expect(workspace(a).threadId).not.toBe(workspace(b).threadId);
    expect(requests("turn/start")).toHaveLength(2);
    expect(workspace(a).messages[0]?.text).toBe("Work in A");
    expect(workspace(b).messages[0]?.text).toBe("Work in B");
  }));

test("late background messages and canvas operations stay with their originating workspace", () =>
  withBackend(async ({ backend, a, b, workspace, session, event }) => {
    await backend.send("Build A", a);
    backend.selectWorkspace(b);
    const delta = `A is still working.\n${JSON.stringify({ op: "append", sel: "#substrate", html: "<p>A only</p>" })}\n`;
    await event({
      method: "item/agentMessage/delta",
      params: { threadId: workspace(a).threadId, itemId: "a-reply", delta },
    });
    await waitFor(
      () => workspace(a).canvas?.pending.length === 1,
      "background A canvas update",
    );
    expect(workspace(a).messages.at(-1)?.text).toContain("A is still working.");
    expect(workspace(a).canvas?.pending[0]?.op).toEqual({
      op: "append",
      sel: "#substrate",
      html: "<p>A only</p>",
    });
    expect(workspace(b).messages).toHaveLength(0);
    expect(workspace(b).canvas?.pending).toHaveLength(0);
    expect(session(a).metrics?.patches).toBe(1);
    expect(backend.state.metrics).toBeNull();
    const canvas = workspace(a).canvas;
    if (!canvas) throw new Error("A should have a canvas");
    const unchangedB = structuredClone(workspace(b));
    backend.updateCanvas(a, {
      revision: 1,
      html: '<main id="substrate"><p>A only</p></main>',
      css: "",
    });
    expect(canvas.pending).toHaveLength(0);
    expect(session(a).metrics?.firstUI).not.toBeNull();
    expect(workspace(b)).toEqual(unchangedB);
    expect(backend.state.activeId).toBe(b);
    expect(backend.state.metrics).toBeNull();
  }));

test("interrupting B targets B alone while A keeps receiving updates", () =>
  withBackend(
    async ({ backend, a, b, workspace, session, requests, event }) => {
      await backend.send("Work in A", a);
      await backend.send("Work in B", b);
      const bTurn = requests("turn/start").find(
        (message) => message.params?.threadId === workspace(b).threadId,
      );
      await backend.interrupt(b);
      await waitFor(() => !session(b).busy, "B interruption");
      expect(requests("turn/interrupt")[0]?.params).toEqual({
        threadId: workspace(b).threadId,
        turnId: `turn-${workspace(b).threadId}-${bTurn?.id}`,
      });
      expect(session(a).busy).toBe(true);
      await event({
        method: "item/agentMessage/delta",
        params: {
          threadId: workspace(a).threadId,
          itemId: "a-reply",
          delta: "A continues.\n",
        },
      });
      await waitFor(
        () =>
          workspace(a).messages.at(-1)?.text.includes("A continues.") === true,
        "A reply after B interruption",
      );
      expect(session(a).metrics?.total).toBeNull();
      expect(session(b).metrics?.total).not.toBeNull();
    },
  ));

test("approvals stay in their workspace and stale approval IDs cannot answer the next request", () =>
  withBackend(
    async ({ backend, a, b, workspace, session, event, readWire }) => {
      await backend.send("Work in A", a);
      await backend.send("Work in B", b);
      for (const [workspaceId, approvalId] of [
        [a, "a-first"],
        [a, "a-second"],
        [b, "b-first"],
      ]) {
        await event({
          id: approvalId,
          method: "item/commandExecution/requestApproval",
          params: {
            threadId: workspace(workspaceId).threadId,
            itemId: approvalId,
            command: `echo ${approvalId}`,
          },
        });
      }
      await waitFor(
        () =>
          session(a).approval?.id === "a-first" &&
          session(b).approval?.id === "b-first",
        "both sessions' approvals",
      );
      backend.selectWorkspace(b);
      expect(backend.state.approval?.id).toBe("b-first");
      expect(() => backend.answer(true, undefined, b, "a-first")).toThrow();
      expect(session(b).approval?.id).toBe("b-first");
      backend.answer(false, undefined, a, "a-first");
      expect(session(a).approval?.id).toBe("a-second");
      expect(() => backend.answer(true, undefined, a, "a-first")).toThrow();
      backend.answer(true, undefined, b, "b-first");
      await waitFor(
        () =>
          readWire().some(
            (message) => message.id === "b-first" && !message.method,
          ),
        "B approval response",
      );
      expect(
        readWire().filter(
          (message) => message.id === "a-first" && !message.method,
        ),
      ).toEqual([{ id: "a-first", result: { decision: "decline" } }]);
      expect(session(a).approval?.id).toBe("a-second");
      expect(session(b).approval).toBeNull();
    },
  ));

test("sending during generation steers the existing turn with its expected ID", () =>
  withBackend(async ({ backend, a, workspace, session, requests }) => {
    await backend.send("Build A", a);
    const start = requests("turn/start")[0];
    const originalMetrics = session(a).metrics;
    await backend.send("Make the heading smaller", a);
    expect(requests("turn/start")).toHaveLength(1);
    expect(requests("turn/steer")).toHaveLength(1);
    expect(requests("turn/steer")[0]?.params).toMatchObject({
      threadId: workspace(a).threadId,
      expectedTurnId: `turn-${workspace(a).threadId}-${start?.id}`,
      input: [
        {
          type: "text",
          text: expect.stringContaining("Make the heading smaller"),
        },
      ],
    });
    expect(
      workspace(a)
        .messages.filter((message) => message.role === "user")
        .map((message) => message.text),
    ).toEqual(["Build A", "Make the heading smaller"]);
    expect(session(a).busy).toBe(true);
    expect(session(a).metrics?.startedAt).toBe(originalMetrics?.startedAt);
    expect(session(a).metrics?.total).toBeNull();
  }));

test("a rejected steer preserves the active turn and does not record an accepted user message", () =>
  withBackend(async ({ backend, a, workspace, session, requests, event }) => {
    await backend.send("Build A", a);
    await expect(backend.send("reject steer please", a)).rejects.toThrow(
      "Steering rejected by fake server",
    );
    expect(session(a).busy).toBe(true);
    expect(session(a).metrics?.total).toBeNull();
    expect(requests("turn/start")).toHaveLength(1);
    expect(
      workspace(a).messages.some(
        (message) => message.text === "reject steer please",
      ),
    ).toBe(false);
    await event({
      method: "item/agentMessage/delta",
      params: {
        threadId: workspace(a).threadId,
        itemId: "a-reply",
        delta: "Original turn continues.\n",
      },
    });
    await waitFor(
      () =>
        workspace(a)
          .messages.at(-1)
          ?.text.includes("Original turn continues.") === true,
      "original turn after rejected steer",
    );
  }));

test("a completion racing with steering rejects the steer without starting a fresh turn", () =>
  withBackend(async ({ backend, a, workspace, session, requests }) => {
    await backend.send("Build A", a);
    await expect(backend.send("race steer please", a)).rejects.toThrow(
      "Turn already completed",
    );
    await waitFor(() => !session(a).busy, "raced turn completion");
    expect(requests("turn/steer")).toHaveLength(1);
    expect(requests("turn/start")).toHaveLength(1);
    expect(
      workspace(a).messages.some(
        (message) => message.text === "race steer please",
      ),
    ).toBe(false);
    expect(backend.state.status).toBe("ready");
  }));

test("transport disconnection clears running sessions and all pending approvals", () =>
  withBackend(async ({ backend, a, b, workspace, session, command, event }) => {
    await backend.send("Work in A", a);
    await backend.send("Work in B", b);
    await event({
      id: "a-approval",
      method: "item/commandExecution/requestApproval",
      params: {
        threadId: workspace(a).threadId,
        itemId: "a-approval",
        command: "echo A",
      },
    });
    await waitFor(
      () => session(a).approval !== null,
      "A approval before disconnect",
    );
    await command({ kind: "disconnect" });
    await waitFor(
      () => backend.state.status === "offline",
      "transport disconnection",
    );
    for (const id of [a, b]) {
      expect(session(id).busy).toBe(false);
      expect(session(id).approval).toBeNull();
    }
    backend.selectWorkspace(b);
    expect(backend.state.status).toBe("offline");
    expect(backend.state.approval).toBeNull();
  }));

test("steering waits for a pending start response and handles completion before steer acceptance", () =>
  withBackend(async ({ backend, a, session, requests, command, workspace }) => {
    await command({ kind: "hold-starts" });
    const starting = backend.send("Build A", a);
    await waitFor(
      () => requests("turn/start").length === 1,
      "pending start request",
    );
    const steering = backend.send("race steer while starting", a).then(
      () => null,
      (error: Error) => error,
    );
    expect(requests("turn/steer")).toHaveLength(0);
    expect(session(a).busy).toBe(true);
    await command({ kind: "release-starts" });
    await starting;
    expect((await steering)?.message).toContain("Turn already completed");
    expect(requests("turn/start")).toHaveLength(1);
    expect(requests("turn/steer")).toHaveLength(1);
    expect(session(a).busy).toBe(false);
    expect(
      workspace(a).messages.some(
        (message) => message.text === "race steer while starting",
      ),
    ).toBe(false);
  }));

test("completion before a delayed start response rejects waiting guidance without restarting", () =>
  withBackend(async ({ backend, a, session, requests, command, workspace }) => {
    await command({ kind: "hold-starts" });
    const starting = backend.send("Build A", a);
    await waitFor(
      () => requests("turn/start").length === 1,
      "pending start request",
    );
    const steering = backend.send("Guidance waiting on start", a).then(
      () => null,
      (error: Error) => error,
    );
    await command({ kind: "release-starts", completeFirst: true });
    await starting;
    expect((await steering)?.message).toContain(
      "finished before your guidance was sent",
    );
    expect(requests("turn/start")).toHaveLength(1);
    expect(requests("turn/steer")).toHaveLength(0);
    expect(session(a).busy).toBe(false);
    expect(
      workspace(a).messages.some(
        (message) => message.text === "Guidance waiting on start",
      ),
    ).toBe(false);
  }));

test("interleaved agent items across steering retain separate ordered replies without duplicate text", () =>
  withBackend(async ({ backend, a, workspace, event, command, session }) => {
    await backend.send("Build A", a);
    const threadId = workspace(a).threadId;
    await event({
      method: "item/agentMessage/delta",
      params: { threadId, itemId: "old-item", delta: "Original " },
    });
    await backend.send("Smaller heading", a);
    await event({
      method: "item/agentMessage/delta",
      params: { threadId, itemId: "old-item", delta: "answer.\n" },
    });
    await event({
      method: "item/agentMessage/delta",
      params: { threadId, itemId: "new-item", delta: "Steered " },
    });
    await event({
      method: "item/agentMessage/delta",
      params: { threadId, itemId: "old-item", delta: "Old tail." },
    });
    await event({
      method: "item/completed",
      params: {
        threadId,
        item: {
          id: "old-item",
          type: "agentMessage",
          text: "Original answer.\nOld tail.",
        },
      },
    });
    await event({
      method: "item/agentMessage/delta",
      params: { threadId, itemId: "new-item", delta: "answer." },
    });
    await event({
      method: "item/completed",
      params: {
        threadId,
        item: { id: "new-item", type: "agentMessage", text: "Steered answer." },
      },
    });
    await command({ kind: "complete", threadId });
    await waitFor(() => !session(a).busy, "interleaved item turn completion");
    expect(
      workspace(a).messages.map(({ role, text }) => ({
        role,
        text: text.trimEnd(),
      })),
    ).toEqual([
      { role: "user", text: "Build A" },
      { role: "assistant", text: "Original answer.\nOld tail." },
      { role: "user", text: "Smaller heading" },
      { role: "assistant", text: "Steered answer." },
    ]);
  }));

test("persisted workspace state excludes transient sessions and approvals", () =>
  withBackend(
    async ({ backend, a, b, workspace, persisted, event, session }) => {
      await backend.send("Build A", a);
      await backend.send("Build B", b);
      await event({
        id: "transient-approval",
        method: "item/commandExecution/requestApproval",
        params: {
          threadId: workspace(a).threadId,
          itemId: "transient-approval",
          command: "echo A",
        },
      });
      await waitFor(
        () => session(a).approval?.id === "transient-approval",
        "transient approval",
      );
      const saved = persisted.at(-1);
      expect(saved).toBeDefined();
      expect(Object.keys(saved ?? {}).sort()).toEqual([
        "activeId",
        "model",
        "reasoningEffort",
        "serviceTier",
        "version",
        "workspaces",
      ]);
      expect(
        saved?.workspaces.find((entry) => entry.id === a)?.messages[0]?.text,
      ).toBe("Build A");
      for (const entry of saved?.workspaces ?? []) {
        expect(Object.keys(entry).sort()).toEqual([
          "canvas",
          "cwd",
          "favorite",
          "id",
          "messages",
          "name",
          "spec",
          "threadId",
        ]);
      }
      expect(JSON.stringify(saved)).not.toContain("transient-approval");
    },
  ));

test("OpenUI updates, edited controls and freeform switching stay in their originating workspace", () =>
  withBackend(
    async ({ backend, a, b, workspace, session, event, command, requests }) => {
      await backend.send("Build a hybrid", a);
      backend.selectWorkspace(b);
      const unchanged = structuredClone(workspace(b));
      const source =
        'root = Stack([title, scene])\n$speed = 1\ntitle = Heading("Hybrid A")\nscene = LiveCanvas({speed: $speed})\n';
      await event({
        method: "item/agentMessage/delta",
        params: {
          threadId: workspace(a).threadId,
          itemId: "hybrid",
          delta: `Here it is.\n\`\`\`openui\n${source}\`\`\`\n`,
        },
      });
      await waitFor(
        () => Boolean(workspace(a).canvas?.openui),
        "background OpenUI layout",
      );
      const canvas = workspace(a).canvas;
      if (!canvas) throw new Error("A must retain its canvas");
      expect(canvas.openui?.source).toBe(source);
      expect(workspace(a).messages.at(-1)?.text).not.toContain("root =");
      expect(session(a).error).toBeNull();
      backend.updateOpenUI(a, canvas.generation, { $speed: 2 });
      expect(canvas.openui?.state).toEqual({ $speed: 2 });
      expect(workspace(b)).toEqual(unchanged);
      expect(backend.state.activeId).toBe(b);
      await command({ kind: "complete", threadId: workspace(a).threadId });
      await waitFor(() => !session(a).busy, "A completion");
      await backend.send("Make it freeform", a);
      const input = requests("turn/start").at(-1)?.params?.input as {
        text: string;
      }[];
      expect(input[0].text).toContain('"$speed":2');
      await event({
        method: "item/agentMessage/delta",
        params: {
          threadId: workspace(a).threadId,
          itemId: "freeform",
          delta: '{"op":"freeform"}\n',
        },
      });
      await waitFor(() => !canvas.openui, "freeform switch");
      expect(canvas.pending).toHaveLength(0);
      await command({ kind: "complete", threadId: workspace(a).threadId });
      await waitFor(() => !session(a).busy, "freeform completion");
      backend.restoreCanvas(canvas.history.length - 1, a);
      expect(canvas.openui?.source).toBe(source);
      expect(canvas.openui?.state).toEqual({ $speed: 2 });
      expect(workspace(b)).toEqual(unchanged);
    },
  ));

test("favoriting a live canvas preserves its running session and rejects empty canvases", () =>
  withBackend(async ({ backend, a, b, workspace, event, session }) => {
    expect(() => backend.setFavorite(b, true)).toThrow();
    await backend.send("Build an app", a);
    await event({
      method: "item/agentMessage/delta",
      params: {
        threadId: workspace(a).threadId,
        itemId: "app",
        delta: '{"op":"append","sel":"#substrate","html":"<h1>My app</h1>"}\n',
      },
    });
    await waitFor(() => workspace(a).canvas?.generation === 1, "an app canvas");
    backend.setFavorite(a, true);
    expect(workspace(a).favorite).toBe(true);
    expect(session(a).busy).toBe(true);
    backend.selectWorkspace(b);
    backend.setFavorite(a, false);
    expect(workspace(a).favorite).toBe(false);
    expect(backend.state.activeId).toBe(b);
    expect(session(a).busy).toBe(true);
  }));

test("deleting an inactive app permanently removes its thread and data while another app runs", () =>
  withBackend(
    async ({
      backend,
      a,
      b,
      workspace,
      command,
      session,
      persisted,
      requests,
      event,
    }) => {
      await backend.send("A private marker to delete", b);
      const threadId = workspace(b).threadId;
      await command({ kind: "complete", threadId });
      await waitFor(() => !session(b).busy, "B completion");
      workspace(b).favorite = true;
      const canvas = workspace(b).canvas;
      if (canvas)
        canvas.history.push({
          html: "deleted history marker",
          css: "",
          generation: 0,
        });
      backend.selectWorkspace(a);
      await backend.send("Keep A running", a);
      await backend.deleteWorkspace(b);
      expect(requests("thread/delete").at(-1)?.params).toEqual({ threadId });
      expect(backend.snapshot().activeId).toBe(a);
      expect(session(a).busy).toBe(true);
      expect(backend.snapshot().sessions[b]).toBeUndefined();
      expect(JSON.stringify(persisted.at(-1))).not.toContain("private marker");
      expect(JSON.stringify(persisted.at(-1))).not.toContain(
        "deleted history marker",
      );
      expect(backend.state.workspaces.some((w) => w.id === b)).toBe(false);
      await event({
        method: "item/agentMessage/delta",
        params: { threadId, itemId: "late", delta: "Resurrect" },
      });
      expect(backend.state.workspaces.some((w) => w.id === b)).toBe(false);
    },
  ));

test("deletion rejects a running target and retains data when Codex cleanup or disk persistence fails", () =>
  withBackend(
    async ({
      backend,
      a,
      workspace,
      command,
      session,
      requests,
      failPersistence,
    }) => {
      await backend.send("Keep my content", a);
      await expect(backend.deleteWorkspace(a)).rejects.toThrow("Stop this app");
      expect(requests("thread/delete")).toHaveLength(0);
      await command({ kind: "complete", threadId: workspace(a).threadId });
      await waitFor(() => !session(a).busy, "completion");
      const before = backend.snapshot();
      await command({ kind: "reject-deletes", value: true });
      await expect(backend.deleteWorkspace(a)).rejects.toThrow(
        "Thread cleanup failed",
      );
      expect(backend.snapshot()).toEqual(before);
      await command({ kind: "reject-deletes", value: false });
      failPersistence(true);
      await expect(backend.deleteWorkspace(a)).rejects.toThrow("Disk is full");
      expect(backend.snapshot()).toEqual(before);
      failPersistence(false);
      await backend.deleteWorkspace(a);
      expect(backend.state.workspaces.some((w) => w.id === a)).toBe(false);
    },
  ));

test("a pending deletion blocks new turns and renames, then the last deletion creates one clean app", () =>
  withBackend(
    async ({
      backend,
      a,
      b,
      workspace,
      command,
      session,
      requests,
      persisted,
    }) => {
      await backend.send("Delete after completion", a);
      await command({ kind: "complete", threadId: workspace(a).threadId });
      await waitFor(() => !session(a).busy, "completion");
      await command({ kind: "hold-deletes" });
      const deleting = backend.deleteWorkspace(a);
      await waitFor(
        () => requests("thread/delete").length === 1,
        "delete request",
      );
      await expect(backend.send("Race", a)).rejects.toThrow("being deleted");
      expect(() => backend.renameWorkspace(a, "Race")).toThrow("being deleted");
      await expect(backend.deleteWorkspace(a)).rejects.toThrow("being deleted");
      await command({ kind: "release-deletes" });
      await deleting;
      await backend.deleteWorkspace(b);
      expect(backend.state.workspaces).toHaveLength(1);
      expect(backend.workspace.name).toBe("New App");
      expect(backend.workspace.messages).toEqual([]);
      expect(backend.workspace.threadId).toBeNull();
      expect(backend.workspace.canvas?.history).toEqual([]);
      expect(persisted.at(-1)?.activeId).toBe(backend.workspace.id);
    },
  ));

test("a thread-backed app needs a live connection to delete while an unused app can be removed offline", () =>
  withBackend(async ({ backend, a, b, workspace, command }) => {
    await backend.send("Retain disconnected history", a);
    await command({ kind: "disconnect" });
    await waitFor(() => backend.state.status === "offline", "disconnect");
    await expect(backend.deleteWorkspace(a)).rejects.toThrow("Reconnect");
    expect(workspace(a).messages[0].text).toBe("Retain disconnected history");
    await backend.deleteWorkspace(b);
    expect(backend.state.workspaces).toHaveLength(1);
  }));

test("names are short, streamed naming stays out of chat, and a manual rename wins over late naming", () =>
  withBackend(async ({ backend, a, b, workspace, event, command }) => {
    await backend.send("Create an orbit dashboard with Three.js", a);
    expect(workspace(a).name).toBe("Orbit Lab");
    const threadId = workspace(a).threadId;
    await event({
      method: "item/agentMessage/delta",
      params: {
        threadId,
        itemId: "title",
        delta: "```codexos-name\nStar Atlas\n```\nReady.\n",
      },
    });
    expect(workspace(a).name).toBe("Star Atlas");
    expect(workspace(a).messages.at(-1)?.text).toBe("Ready.\n");
    await command({ kind: "complete", threadId });
    await waitFor(() => !backend.snapshot().sessions[a].busy, "completion");
    await backend.send("Change the sky", a);
    await event({
      method: "item/agentMessage/delta",
      params: {
        threadId,
        itemId: "late-title",
        delta: "```codexos-name\nChanged Name\n```\n",
      },
    });
    expect(workspace(a).name).toBe("Star Atlas");
    await backend.send("Make a music player", b);
    backend.renameWorkspace(b, "My Radio");
    await event({
      method: "item/agentMessage/delta",
      params: {
        threadId: workspace(b).threadId,
        itemId: "late-title",
        delta: "```codexos-name\nMusic Room\n```\n",
      },
    });
    expect(workspace(b).name).toBe("My Radio");
    expect(() =>
      backend.renameWorkspace(b, "A really long app name"),
    ).toThrow();
  }));

test("retry after a confirmed missing Codex thread still removes local app data", () =>
  withBackend(async ({ backend, a, workspace, command, session, requests }) => {
    await backend.send("Already deleted at Codex", a);
    await command({ kind: "complete", threadId: workspace(a).threadId });
    await waitFor(() => !session(a).busy, "completion");
    await command({ kind: "already-deleted" });
    await backend.deleteWorkspace(a);
    expect(requests("thread/read")).toHaveLength(1);
    expect(backend.state.workspaces.some((w) => w.id === a)).toBe(false);
  }));
