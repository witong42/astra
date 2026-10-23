import {
  type ChildProcessWithoutNullStreams,
  execFileSync,
  spawn,
} from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  acknowledgeCanvas,
  beginCanvasGeneration,
  CanvasStream,
  emptyCanvas,
  queueCanvasOp,
  restoreCanvas,
} from "./canvas";
import { CANVAS_INSTRUCTIONS } from "./canvas-prompt";
import { applyOpenUI, inspectOpenUI, updateOpenUIState } from "./openui";
import { type RpcMessage, RpcPeer } from "./rpc";
import { newWorkspace } from "./storage";
import { applySurfacePatch } from "./surface";
import type {
  Approval,
  Metrics,
  Model,
  Question,
  SavedState,
  SessionStatus,
  Snapshot,
  Workspace,
} from "./types";

const MAX_MESSAGES = 80;
const MAX_WORKSPACES = 20;
const PROMPT_LIMIT = 24_000;
const UI_CONTEXT_LIMIT = 600_000;
const questionsSchema = z.array(
  z.object({
    id: z.string(),
    header: z.string().default("Question"),
    question: z.string(),
    options: z
      .array(z.object({ label: z.string(), description: z.string() }))
      .default([]),
  }),
);

export function findCodex() {
  const candidates = [
    process.env.CODEXOS_CODEX_PATH,
    join(homedir(), ".local/bin/codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
  ];
  const path = candidates.find(
    (candidate) => candidate && existsSync(candidate),
  );
  if (!path)
    throw new Error(
      "Codex CLI was not found. Install Codex or set CODEXOS_CODEX_PATH to its executable.",
    );
  return path;
}

type Session = {
  busy: boolean;
  activity: string;
  error: string | null;
  metrics: Metrics | null;
  turnId: string | null;
  initialReplyId: string | null;
  replies: Map<string, string>;
  streams: Map<string, CanvasStream>;
  approvalQueue: { approval: Approval; params: Record<string, unknown> }[];
  canvasMutated: boolean;
  canvasBaseRevision: number;
  fileChanges: Map<string, string>;
  starting: Promise<void> | null;
  settings: SessionStatus["settings"];
};
function newSession(): Session {
  return {
    busy: false,
    activity: "Ready",
    error: null,
    metrics: null,
    turnId: null,
    initialReplyId: null,
    replies: new Map(),
    streams: new Map(),
    approvalQueue: [],
    canvasMutated: false,
    canvasBaseRevision: 0,
    fileChanges: new Map(),
    starting: null,
    settings: null,
  };
}

export class CodexBackend {
  readonly state: Snapshot;
  private child: ChildProcessWithoutNullStreams | null = null;
  private rpc: RpcPeer | null = null;
  private loaded = new Set<string>();
  private sessions = new Map<string, Session>();
  private connectionError: string | null = null;
  private starting: Promise<void> | null = null;
  private stopping = false;

  constructor(
    saved: SavedState,
    private publish: (snapshot: Snapshot) => void,
    private persist: (saved: SavedState) => void,
  ) {
    this.state = {
      ...saved,
      sessions: {},
      status: "connecting",
      activity: "Connecting to Codex",
      account: "",
      backendVersion: "",
      models: [],
      approval: null,
      error: null,
      metrics: null,
    };
  }

  get workspace(): Workspace {
    return this.state.workspaces.find(
      (workspace) => workspace.id === this.state.activeId,
    ) as Workspace;
  }
  snapshot(): Snapshot {
    return structuredClone(this.state);
  }

  private findWorkspace(id: string): Workspace {
    const workspace = this.state.workspaces.find((entry) => entry.id === id);
    if (!workspace)
      throw new Error("Workspace not found. Reopen a saved workspace.");
    return workspace;
  }

  private sessionFor(id: string): Session {
    let session = this.sessions.get(id);
    if (!session) {
      session = newSession();
      this.sessions.set(id, session);
    }
    return session;
  }

  private projectSessions() {
    const active = this.sessionFor(this.state.activeId);
    this.state.sessions = Object.fromEntries(
      [...this.sessions].map(([id, session]) => [
        id,
        {
          busy: session.busy,
          activity: session.activity,
          error: session.error,
          metrics: session.metrics,
          approval: session.approvalQueue[0]?.approval ?? null,
          settings: session.settings,
        },
      ]),
    );
    if (this.state.status === "ready" || this.state.status === "working") {
      this.state.status = active.busy ? "working" : "ready";
      this.state.activity = active.activity;
    }
    this.state.approval = active.approvalQueue[0]?.approval ?? null;
    this.state.metrics = active.metrics;
    this.state.error = this.connectionError ?? active.error;
  }

  private changed() {
    this.projectSessions();
    const {
      version,
      activeId,
      model,
      reasoningEffort,
      serviceTier,
      workspaces,
    } = this.state;
    try {
      this.persist({
        version,
        activeId,
        model,
        reasoningEffort,
        serviceTier,
        workspaces,
      });
    } catch (error) {
      this.state.error = String(error);
    }
    this.publish(this.snapshot());
  }

  async connect() {
    if (this.starting) return this.starting;
    this.starting = this.start();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  private async start() {
    if (this.child) await this.stop();
    this.stopping = false;
    this.state.status = "connecting";
    this.connectionError = null;
    this.state.activity = "Connecting to Codex";
    this.changed();
    const executable = findCodex();
    this.state.backendVersion = execFileSync(executable, ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
    }).trim();
    const child = spawn(executable, ["app-server", "--listen", "stdio://"], {
      cwd: this.workspace.cwd,
      env: {
        ...process.env,
        CODEX_HOME: join(homedir(), ".codex"),
        PATH: `${join(homedir(), ".local/bin")}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ""}`,
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.child = child;
    const rpc = new RpcPeer(
      child.stdout,
      child.stdin,
      (message) => {
        try {
          this.handleEvent(message);
        } catch {
          const workspace =
            this.state.workspaces.find(
              (entry) => entry.threadId === message.params?.threadId,
            ) ?? this.workspace;
          this.sessionFor(workspace.id).error =
            "Codex sent an unsupported request. Reconnect to continue.";
          if (message.id !== undefined)
            rpc.write({
              id: message.id,
              error: { code: -32602, message: "Invalid request parameters" },
            });
          this.changed();
        }
      },
      undefined,
      (error) => {
        if (this.rpc === rpc && !this.stopping) this.disconnected(error);
      },
    );
    this.rpc = rpc;
    child.stderr.on("data", () => {
      /* Codex owns diagnostic logs; do not mirror auth-bearing stderr into the UI. */
    });
    child.on("error", (error) => this.disconnected(error));
    child.on("exit", () => {
      if (this.child === child && !this.stopping)
        this.disconnected(new Error("Codex stopped. Reconnect to continue."));
    });
    await rpc.request("initialize", {
      clientInfo: { name: "codexos", title: "CodexOS", version: "0.1.0" },
    });
    rpc.write({ method: "initialized", params: {} });
    const [account, models, config] = await Promise.all([
      rpc.request<{ account: { type: string; planType?: string } | null }>(
        "account/read",
        { refreshToken: false },
      ),
      rpc.request<{ data: Model[] }>("model/list", {}),
      rpc.request<{ config: { model?: string } }>("config/read", {}),
    ]);
    this.state.models = models.data;
    if (
      !this.state.model ||
      !models.data.some((model) => model.model === this.state.model)
    )
      this.state.model =
        config.config.model ??
        models.data.find((model) => model.isDefault)?.model ??
        models.data[0]?.model ??
        "";
    this.normalizeModelSettings();
    this.state.account = account.account
      ? account.account.type === "chatgpt"
        ? `ChatGPT ${account.account.planType ?? ""}`.trim()
        : "API account"
      : "Not signed in";
    this.state.status = account.account ? "ready" : "offline";
    this.state.activity = account.account
      ? "Ready"
      : "Sign in using codex login, then reconnect";
    this.changed();
  }

  private resetSessions() {
    for (const session of this.sessions.values()) {
      session.busy = false;
      session.turnId = null;
      session.approvalQueue = [];
      session.streams.clear();
      session.activity = "Disconnected";
      if (session.metrics && session.metrics.total === null)
        session.metrics.total = Date.now() - session.metrics.startedAt;
    }
  }

  private disconnected(error: Error) {
    this.rpc?.close(error);
    this.state.status = "offline";
    this.connectionError = error.message;
    this.state.activity = "Disconnected";
    this.resetSessions();
    this.loaded.clear();
    this.changed();
  }

  private surfaceInput(text: string, workspace: Workspace) {
    const context = JSON.stringify(
      workspace.canvas
        ? {
            html: workspace.canvas.html,
            css: workspace.canvas.css,
            generation: workspace.canvas.generation,
            ...(workspace.canvas.openui
              ? { openui: workspace.canvas.openui }
              : {}),
          }
        : { legacySurface: workspace.spec },
    );
    if (context.length > UI_CONTEXT_LIMIT)
      throw new Error(
        "This workspace is too large for live UI editing. Start a new workspace to keep generation fast.",
      );
    return [
      {
        type: "text",
        text: `${text}\n\n<codexos_current_surface_data>\n${context}\n</codexos_current_surface_data>`,
      },
    ];
  }

  async send(input: string, workspaceId = this.state.activeId) {
    const text = z.string().trim().min(1).max(PROMPT_LIMIT).parse(input);
    if (
      !this.rpc ||
      this.state.status === "connecting" ||
      this.state.status === "offline"
    )
      throw new Error("Reconnect to Codex before sending a message.");
    const workspace = this.findWorkspace(workspaceId);
    const current = this.sessionFor(workspaceId);
    if (current.busy) {
      await current.starting;
      if (
        !current.busy ||
        !current.turnId ||
        this.sessions.get(workspaceId) !== current
      )
        throw new Error(
          "That turn finished before your guidance was sent. Send it again to start a new turn.",
        );
      const message = { id: crypto.randomUUID(), role: "user" as const, text };
      const input = this.surfaceInput(text, workspace);
      workspace.messages.push(message);
      current.error = null;
      this.changed();
      try {
        await this.rpc.request("turn/steer", {
          threadId: workspace.threadId,
          expectedTurnId: current.turnId,
          clientUserMessageId: message.id,
          input,
        });
        workspace.messages = workspace.messages.slice(-MAX_MESSAGES);
        this.changed();
      } catch (error) {
        workspace.messages = workspace.messages.filter(
          (entry) => entry.id !== message.id,
        );
        current.error = `Guidance was not sent: ${String(error)}`;
        this.changed();
        throw error;
      }
      return;
    }
    const session = newSession();
    session.busy = true;
    session.activity = "Thinking";
    session.metrics = {
      startedAt: Date.now(),
      firstUI: null,
      total: null,
      patches: 0,
    };
    session.canvasBaseRevision = workspace.canvas?.revision ?? 0;
    const turnInput = this.surfaceInput(text, workspace);
    if (workspace.messages.length === 0) workspace.name = text.slice(0, 70);
    workspace.messages.push({ id: crypto.randomUUID(), role: "user", text });
    session.initialReplyId = crypto.randomUUID();
    workspace.messages.push({
      id: session.initialReplyId,
      role: "assistant",
      text: "",
    });
    workspace.messages = workspace.messages.slice(-MAX_MESSAGES);
    this.sessions.set(workspaceId, session);
    const settings = {
      model: this.state.model,
      effort: this.state.reasoningEffort || undefined,
      serviceTierForTurn: this.state.serviceTier,
    };
    session.settings = {
      model: settings.model,
      reasoningEffort: this.state.reasoningEffort,
      serviceTier: this.state.serviceTier,
    };
    const rpc = this.rpc;
    this.changed();
    session.starting = (async () => {
      try {
        if (!workspace.threadId) {
          const result = await rpc.request<{ thread: { id: string } }>(
            "thread/start",
            {
              cwd: workspace.cwd,
              model: settings.model,
              developerInstructions: CANVAS_INSTRUCTIONS,
            },
          );
          workspace.threadId = result.thread.id;
          this.loaded.add(workspace.threadId);
        } else if (!this.loaded.has(workspace.threadId)) {
          await rpc.request("thread/resume", {
            threadId: workspace.threadId,
            excludeTurns: true,
            developerInstructions: CANVAS_INSTRUCTIONS,
          });
          this.loaded.add(workspace.threadId);
        }
        if (!session.busy || this.rpc !== rpc)
          throw new Error(
            "The connection changed before the turn could start.",
          );
        const result = await rpc.request<{ turn: { id: string } }>(
          "turn/start",
          {
            threadId: workspace.threadId,
            ...settings,
            input: turnInput,
          },
        );
        if (session.busy) session.turnId = result.turn.id;
        this.changed();
      } catch (error) {
        if (this.sessions.get(workspaceId) === session)
          this.finish(workspace, session, String(error));
        throw error;
      }
    })();
    await session.starting;
    session.starting = null;
  }

  private replyFor(workspace: Workspace, session: Session, itemId: string) {
    let id = session.replies.get(itemId);
    if (!id) {
      id = session.initialReplyId ?? crypto.randomUUID();
      session.initialReplyId = null;
      session.replies.set(itemId, id);
      if (!workspace.messages.some((entry) => entry.id === id)) {
        workspace.messages.push({ id, role: "assistant", text: "" });
        workspace.messages = workspace.messages.slice(-MAX_MESSAGES);
      }
    }
    return id;
  }

  private handleEvent(message: RpcMessage) {
    const params = message.params ?? {};
    const workspace =
      typeof params.threadId === "string"
        ? this.state.workspaces.find(
            (entry) => entry.threadId === params.threadId,
          )
        : undefined;
    const session = workspace ? this.sessions.get(workspace.id) : undefined;
    const incomingTurn = String(
      params.turnId ?? (params.turn as { id?: string } | undefined)?.id ?? "",
    );
    if (
      !workspace ||
      !session?.busy ||
      (session.turnId && incomingTurn && session.turnId !== incomingTurn)
    ) {
      if (message.id !== undefined)
        this.rpc?.write({
          id: message.id,
          error: {
            code: -32602,
            message: "That workspace has no matching active turn.",
          },
        });
      else if (message.method === "error" && !params.threadId) {
        this.connectionError = String(
          (params.error as { message?: string })?.message ??
            "Codex reported a connection error.",
        );
        this.changed();
      }
      return;
    }
    if (message.id !== undefined) {
      this.serverRequest(message, session);
      return;
    }
    if (
      message.method === "item/agentMessage/delta" &&
      typeof params.delta === "string"
    ) {
      const id = String(params.itemId ?? "assistant");
      const replyId = this.replyFor(workspace, session, id);
      let stream = session.streams.get(id);
      if (!stream) {
        stream = new CanvasStream(
          (patch) => {
            try {
              workspace.canvas ??= emptyCanvas();
              if (!session.canvasMutated) {
                beginCanvasGeneration(workspace.canvas);
                session.canvasMutated = true;
              }
              if (patch.op === "freeform") delete workspace.canvas.openui;
              else queueCanvasOp(workspace.canvas, patch);
              if (session.metrics) {
                session.metrics.patches++;
              }
              session.activity = "Updating workspace";
            } catch (error) {
              session.error = `A UI update was rejected: ${error instanceof Error ? error.message : String(error)}`;
            }
          },
          (text) => {
            const reply = workspace.messages.find(
              (entry) => entry.id === replyId,
            );
            if (reply) reply.text = `${reply.text}${text}`.slice(-100_000);
          },
          (error) => {
            session.error = `A canvas update was rejected: ${error}`;
          },
          (source, complete) => {
            if (workspace.canvas?.openui?.source === source) return;
            const result = inspectOpenUI(source, complete);
            if (
              !result.root ||
              result.meta.unresolved.length ||
              result.meta.incomplete
            )
              return;
            workspace.canvas ??= emptyCanvas();
            if (!session.canvasMutated) {
              beginCanvasGeneration(workspace.canvas);
              session.canvasMutated = true;
            }
            applyOpenUI(workspace.canvas, source, complete);
            if (session.metrics) session.metrics.patches++;
            session.activity = "Composing workspace";
          },
        );
        session.streams.set(id, stream);
      }
      stream.push(params.delta);
      this.changed();
    } else if (message.method === "turn/started") {
      session.turnId = String((params.turn as { id?: string })?.id ?? "");
    } else if (message.method === "turn/completed") {
      const turn = params.turn as
        | { status?: string; error?: { message?: string } }
        | undefined;
      this.finish(
        workspace,
        session,
        turn?.status === "failed"
          ? (turn.error?.message ?? "Codex could not finish this request.")
          : undefined,
      );
    } else if (message.method === "item/completed") {
      const item = params.item as { id?: string } | undefined;
      if (item?.id) session.streams.get(item.id)?.flush();
      this.changed();
    } else if (message.method === "item/started") {
      const item = params.item as
        | { type?: string; id?: string; changes?: unknown[] }
        | undefined;
      if (item?.type === "fileChange" && item.id && item.changes)
        session.fileChanges.set(item.id, JSON.stringify(item.changes, null, 2));
      if (item?.type && item.type !== "agentMessage") {
        session.activity =
          item.type === "commandExecution"
            ? "Running a command"
            : item.type === "reasoning"
              ? "Thinking"
              : "Working";
        this.changed();
      }
    } else if (message.method === "error") {
      const error = params.error as { message?: string } | undefined;
      if (error?.message) {
        session.error = error.message;
        this.changed();
      }
    }
  }

  private finish(workspace: Workspace, session: Session, error?: string) {
    if (this.sessions.get(workspace.id) !== session) return;
    for (const stream of session.streams.values()) stream.flush();
    session.streams.clear();
    if (session.metrics)
      session.metrics.total = Date.now() - session.metrics.startedAt;
    session.busy = false;
    session.activity = "Ready";
    session.approvalQueue = [];
    session.turnId = null;
    if (error) session.error = error;
    this.changed();
  }

  private serverRequest(message: RpcMessage, session: Session) {
    const params = message.params ?? {};
    let kind: Approval["kind"];
    if (message.method === "item/commandExecution/requestApproval")
      kind = "command";
    else if (message.method === "item/fileChange/requestApproval")
      kind = "file";
    else if (message.method === "item/tool/requestUserInput") kind = "question";
    else if (message.method === "item/permissions/requestApproval")
      kind = "permissions";
    else {
      this.rpc?.write({
        id: message.id,
        error: {
          code: -32601,
          message: `CodexOS does not support ${message.method}. No action was taken.`,
        },
      });
      return;
    }
    let questions: Question[] | undefined;
    if (kind === "question")
      questions = questionsSchema.parse(params.questions);
    const approval: Approval = {
      id: message.id as string | number,
      kind,
      summary:
        kind === "question"
          ? "Codex needs your input"
          : String(params.reason ?? "Codex is requesting approval"),
      details: String(
        params.command ??
          (kind === "file"
            ? session.fileChanges.get(String(params.itemId))
            : undefined) ??
          params.grantRoot ??
          (kind === "permissions"
            ? JSON.stringify(params.permissions ?? {})
            : "Review the proposed file changes before approving."),
      ),
      questions,
    };
    session.approvalQueue.push({ approval, params });
    session.activity = "Waiting for you";
    this.changed();
  }

  answer(
    allow: boolean,
    answers?: Record<string, string>,
    workspaceId = this.state.activeId,
    approvalId?: string | number,
  ) {
    this.findWorkspace(workspaceId);
    const session = this.sessionFor(workspaceId);
    const approval = session.approvalQueue[0]?.approval;
    if (approvalId !== undefined && approval?.id !== approvalId)
      throw new Error(
        "This request is no longer pending. Review the current request before answering.",
      );
    if (!approval || !this.rpc) throw new Error("There is no pending request.");
    const result =
      approval.kind === "question"
        ? {
            answers: Object.fromEntries(
              (approval.questions ?? []).map((question) => [
                question.id,
                { answers: [answers?.[question.id] ?? ""] },
              ]),
            ),
          }
        : approval.kind === "permissions"
          ? {
              permissions: allow
                ? (session.approvalQueue[0]?.params.permissions ?? {})
                : {},
              scope: "turn",
            }
          : { decision: allow ? "accept" : "decline" };
    this.rpc.write({ id: approval.id, result });
    session.approvalQueue.shift();
    session.activity = session.approvalQueue.length
      ? "Waiting for you"
      : "Working";
    this.changed();
  }

  async interrupt(workspaceId = this.state.activeId) {
    const workspace = this.findWorkspace(workspaceId);
    const session = this.sessionFor(workspaceId);
    await session.starting;
    if (session.busy && session.turnId && this.rpc && workspace.threadId)
      await this.rpc.request("turn/interrupt", {
        threadId: workspace.threadId,
        turnId: session.turnId,
      });
  }

  createWorkspace(cwd = this.workspace.cwd) {
    if (this.state.workspaces.length >= MAX_WORKSPACES)
      throw new Error("CodexOS currently supports 20 saved workspaces.");
    const workspace = newWorkspace(cwd);
    this.state.workspaces.unshift(workspace);
    this.state.activeId = workspace.id;
    this.changed();
  }

  selectWorkspace(id: string) {
    if (!this.state.workspaces.some((workspace) => workspace.id === id))
      throw new Error("Workspace does not exist.");
    this.state.activeId = id;
    this.changed();
  }

  setModel(model: string) {
    if (this.sessionFor(this.state.activeId).busy)
      throw new Error("Finish the current request first.");
    if (!this.state.models.some((entry) => entry.model === model))
      throw new Error("Choose an available Codex model.");
    this.state.model = model;
    this.normalizeModelSettings();
    this.changed();
  }

  private normalizeModelSettings() {
    const model = this.state.models.find(
      (entry) => entry.model === this.state.model,
    );
    if (
      !model?.supportedReasoningEfforts?.some(
        (entry) => entry.reasoningEffort === this.state.reasoningEffort,
      )
    )
      this.state.reasoningEffort =
        model?.defaultReasoningEffort ??
        model?.supportedReasoningEfforts?.[0]?.reasoningEffort ??
        "";
    if (
      this.state.serviceTier !== "default" &&
      !model?.serviceTiers?.some((entry) => entry.id === this.state.serviceTier)
    )
      this.state.serviceTier = "default";
  }

  setReasoningEffort(effort: string) {
    if (this.sessionFor(this.state.activeId).busy)
      throw new Error("Wait for Codex to finish before changing reasoning.");
    const model = this.state.models.find(
      (entry) => entry.model === this.state.model,
    );
    if (
      !model?.supportedReasoningEfforts?.some(
        (entry) => entry.reasoningEffort === effort,
      )
    )
      throw new Error("Choose a reasoning level supported by this model.");
    this.state.reasoningEffort = effort;
    this.changed();
  }

  setServiceTier(tier: string) {
    if (this.sessionFor(this.state.activeId).busy)
      throw new Error("Wait for Codex to finish before changing speed.");
    const model = this.state.models.find(
      (entry) => entry.model === this.state.model,
    );
    if (
      tier !== "default" &&
      !model?.serviceTiers?.some((entry) => entry.id === tier)
    )
      throw new Error("Choose a speed supported by this model.");
    this.state.serviceTier = tier;
    this.changed();
  }

  updateData(id: string, path: string, value: unknown) {
    const workspace = this.findWorkspace(id);
    workspace.spec = applySurfacePatch(workspace.spec, {
      op: "add",
      path: `/state${path}`,
      value,
    });
    this.changed();
  }

  updateCanvas(id: string, ack: unknown) {
    const workspace = this.findWorkspace(id);
    const session = this.sessionFor(id);
    const canvas = workspace.canvas;
    if (!canvas) throw new Error("This workspace has no live document yet.");
    const error = acknowledgeCanvas(canvas, ack);
    if (error) session.error = `A canvas update was rejected: ${error}`;
    if (
      session.metrics &&
      session.metrics.firstUI === null &&
      session.metrics.patches > 0 &&
      (canvas.revision > session.canvasBaseRevision || Boolean(canvas.openui))
    )
      session.metrics.firstUI = Date.now() - session.metrics.startedAt;
    this.changed();
  }

  updateOpenUI(id: string, generation: number, state: unknown) {
    const canvas = this.findWorkspace(id).canvas;
    if (!canvas) throw new Error("This workspace has no live document yet.");
    updateOpenUIState(canvas, generation, state);
    this.changed();
  }

  restoreCanvas(index: number, workspaceId = this.state.activeId) {
    const workspace = this.findWorkspace(workspaceId);
    const session = this.sessionFor(workspaceId);
    if (session.busy)
      throw new Error("Stop Codex before restoring a previous version.");
    if (!workspace.canvas)
      throw new Error("This workspace has no canvas history.");
    restoreCanvas(workspace.canvas, index);
    session.error = null;
    session.metrics = null;
    this.changed();
  }

  async stop() {
    this.stopping = true;
    this.resetSessions();
    this.state.status = "offline";
    this.state.activity = "Disconnected";
    this.changed();
    this.rpc?.close();
    const child = this.child;
    this.child = null;
    this.rpc = null;
    this.loaded.clear();
    if (child && child.exitCode === null) {
      child.stdin.end();
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 2_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
}
