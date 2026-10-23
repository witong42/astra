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
import { type RpcMessage, RpcPeer } from "./rpc";
import { newWorkspace } from "./storage";
import { applySurfacePatch } from "./surface";
import type {
  Approval,
  Model,
  Question,
  SavedState,
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

export class CodexBackend {
  readonly state: Snapshot;
  private child: ChildProcessWithoutNullStreams | null = null;
  private rpc: RpcPeer | null = null;
  private loaded = new Set<string>();
  private turnId: string | null = null;
  private activeMessageId: string | null = null;
  private streams = new Map<string, CanvasStream>();
  private approvalQueue: {
    approval: Approval;
    params: Record<string, unknown>;
  }[] = [];
  private canvasMutated = false;
  private canvasBaseRevision = 0;
  private fileChanges = new Map<string, string>();
  private starting: Promise<void> | null = null;
  private stopping = false;

  constructor(
    saved: SavedState,
    private publish: (snapshot: Snapshot) => void,
    private persist: (saved: SavedState) => void,
  ) {
    this.state = {
      ...saved,
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

  private changed() {
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
    this.state.error = null;
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
          this.state.error =
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

  private disconnected(error: Error) {
    this.rpc?.close(error);
    this.state.status = "offline";
    this.state.error = error.message;
    this.state.activity = "Disconnected";
    this.state.approval = null;
    this.approvalQueue = [];
    this.loaded.clear();
    this.changed();
  }

  async send(input: string) {
    const text = z.string().trim().min(1).max(PROMPT_LIMIT).parse(input);
    if (this.state.status !== "ready" || !this.rpc)
      throw new Error("Wait for Codex to finish or reconnect first.");
    this.state.status = "working";
    this.state.activity = "Thinking";
    this.state.error = null;
    this.state.metrics = {
      startedAt: Date.now(),
      firstUI: null,
      total: null,
      patches: 0,
    };
    this.streams.clear();
    this.canvasMutated = false;
    this.canvasBaseRevision = this.workspace.canvas?.revision ?? 0;
    this.fileChanges.clear();
    const workspace = this.workspace;
    if (workspace.messages.length === 0) workspace.name = text.slice(0, 70);
    workspace.messages.push({ id: crypto.randomUUID(), role: "user", text });
    this.activeMessageId = crypto.randomUUID();
    workspace.messages.push({
      id: this.activeMessageId,
      role: "assistant",
      text: "",
    });
    workspace.messages = workspace.messages.slice(-MAX_MESSAGES);
    this.changed();
    try {
      if (!workspace.threadId) {
        const result = await this.rpc.request<{ thread: { id: string } }>(
          "thread/start",
          {
            cwd: workspace.cwd,
            model: this.state.model,
            developerInstructions: CANVAS_INSTRUCTIONS,
          },
        );
        workspace.threadId = result.thread.id;
        this.loaded.add(workspace.threadId);
      } else if (!this.loaded.has(workspace.threadId)) {
        await this.rpc.request("thread/resume", {
          threadId: workspace.threadId,
          excludeTurns: true,
          developerInstructions: CANVAS_INSTRUCTIONS,
        });
        this.loaded.add(workspace.threadId);
      }
      const context = JSON.stringify(
        workspace.canvas
          ? {
              html: workspace.canvas.html,
              css: workspace.canvas.css,
              generation: workspace.canvas.generation,
            }
          : { legacySurface: workspace.spec },
      );
      if (context.length > UI_CONTEXT_LIMIT)
        throw new Error(
          "This workspace is too large for live UI editing. Start a new workspace to keep generation fast.",
        );
      const result = await this.rpc.request<{ turn: { id: string } }>(
        "turn/start",
        {
          threadId: workspace.threadId,
          model: this.state.model,
          effort: this.state.reasoningEffort || undefined,
          serviceTierForTurn: this.state.serviceTier,
          input: [
            {
              type: "text",
              text: `${text}\n\n<codexos_current_surface_data>\n${context}\n</codexos_current_surface_data>`,
            },
          ],
        },
      );
      this.turnId = result.turn.id;
      this.changed();
    } catch (error) {
      this.finish(String(error));
      throw error;
    }
  }

  private handleEvent(message: RpcMessage) {
    const params = message.params ?? {};
    if (params.threadId && params.threadId !== this.workspace.threadId) {
      if (message.id !== undefined)
        this.rpc?.write({
          id: message.id,
          error: { code: -32602, message: "That workspace is not active." },
        });
      return;
    }
    if (message.id !== undefined) {
      this.serverRequest(message);
      return;
    }
    if (
      message.method === "item/agentMessage/delta" &&
      typeof params.delta === "string"
    ) {
      const id = String(params.itemId ?? "assistant");
      let stream = this.streams.get(id);
      if (!stream) {
        stream = new CanvasStream(
          (patch) => {
            try {
              this.workspace.canvas ??= emptyCanvas();
              if (!this.canvasMutated) {
                beginCanvasGeneration(this.workspace.canvas);
                this.canvasMutated = true;
              }
              queueCanvasOp(this.workspace.canvas, patch);
              if (this.state.metrics) {
                this.state.metrics.patches++;
              }
              this.state.activity = "Updating workspace";
            } catch (error) {
              this.state.error = `A UI update was rejected: ${error instanceof Error ? error.message : String(error)}`;
            }
          },
          (text) => {
            const reply = this.workspace.messages.find(
              (entry) => entry.id === this.activeMessageId,
            );
            if (reply) reply.text = `${reply.text}${text}`.slice(-100_000);
          },
          (error) => {
            this.state.error = `A canvas update was rejected: ${error}`;
          },
        );
        this.streams.set(id, stream);
      }
      stream.push(params.delta);
      this.changed();
    } else if (message.method === "turn/started") {
      this.turnId = String((params.turn as { id?: string })?.id ?? "");
    } else if (message.method === "turn/completed") {
      const turn = params.turn as
        | { status?: string; error?: { message?: string } }
        | undefined;
      this.finish(
        turn?.status === "failed"
          ? (turn.error?.message ?? "Codex could not finish this request.")
          : undefined,
      );
    } else if (message.method === "item/started") {
      const item = params.item as
        | { type?: string; id?: string; changes?: unknown[] }
        | undefined;
      if (item?.type === "fileChange" && item.id && item.changes)
        this.fileChanges.set(item.id, JSON.stringify(item.changes, null, 2));
      if (item?.type && item.type !== "agentMessage") {
        this.state.activity =
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
        this.state.error = error.message;
        this.changed();
      }
    }
  }

  private finish(error?: string) {
    for (const stream of this.streams.values()) stream.flush();
    this.streams.clear();
    if (this.state.metrics)
      this.state.metrics.total = Date.now() - this.state.metrics.startedAt;
    if (this.state.status !== "offline") this.state.status = "ready";
    this.state.activity = "Ready";
    this.state.approval = null;
    this.approvalQueue = [];
    this.turnId = null;
    if (error) this.state.error = error;
    this.changed();
  }

  private serverRequest(message: RpcMessage) {
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
            ? this.fileChanges.get(String(params.itemId))
            : undefined) ??
          params.grantRoot ??
          (kind === "permissions"
            ? JSON.stringify(params.permissions ?? {})
            : "Review the proposed file changes before approving."),
      ),
      questions,
    };
    this.approvalQueue.push({ approval, params });
    this.state.approval ??= approval;
    this.state.activity = "Waiting for you";
    this.changed();
  }

  answer(allow: boolean, answers?: Record<string, string>) {
    const approval = this.state.approval;
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
                ? (this.approvalQueue[0]?.params.permissions ?? {})
                : {},
              scope: "turn",
            }
          : { decision: allow ? "accept" : "decline" };
    this.rpc.write({ id: approval.id, result });
    this.approvalQueue.shift();
    this.state.approval = this.approvalQueue[0]?.approval ?? null;
    this.state.activity = this.state.approval ? "Waiting for you" : "Working";
    this.changed();
  }

  async interrupt() {
    if (this.turnId && this.rpc && this.workspace.threadId)
      await this.rpc.request("turn/interrupt", {
        threadId: this.workspace.threadId,
        turnId: this.turnId,
      });
  }

  createWorkspace(cwd = this.workspace.cwd) {
    if (this.state.status === "working")
      throw new Error("Finish or stop the current request first.");
    if (this.state.workspaces.length >= MAX_WORKSPACES)
      throw new Error("CodexOS currently supports 20 saved workspaces.");
    const workspace = newWorkspace(cwd);
    this.state.workspaces.unshift(workspace);
    this.state.activeId = workspace.id;
    this.state.error = null;
    this.state.metrics = null;
    this.changed();
  }

  selectWorkspace(id: string) {
    if (this.state.status === "working")
      throw new Error("Finish or stop the current request first.");
    if (!this.state.workspaces.some((workspace) => workspace.id === id))
      throw new Error("Workspace does not exist.");
    this.state.activeId = id;
    this.state.metrics = null;
    this.state.error = null;
    this.changed();
  }

  setModel(model: string) {
    if (this.state.status === "working")
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
    if (this.state.status === "working")
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
    if (this.state.status === "working")
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
    if (id !== this.state.activeId)
      throw new Error("That workspace is no longer active.");
    this.workspace.spec = applySurfacePatch(this.workspace.spec, {
      op: "add",
      path: `/state${path}`,
      value,
    });
    this.changed();
  }

  updateCanvas(id: string, ack: unknown) {
    if (id !== this.state.activeId)
      throw new Error("That workspace is no longer active.");
    const canvas = this.workspace.canvas;
    if (!canvas) throw new Error("This workspace has no live document yet.");
    const error = acknowledgeCanvas(canvas, ack);
    if (error) this.state.error = `A canvas update was rejected: ${error}`;
    if (
      this.state.metrics &&
      this.state.metrics.firstUI === null &&
      this.state.metrics.patches > 0 &&
      canvas.revision > this.canvasBaseRevision
    )
      this.state.metrics.firstUI = Date.now() - this.state.metrics.startedAt;
    this.changed();
  }

  restoreCanvas(index: number) {
    if (this.state.status === "working")
      throw new Error("Stop Codex before restoring a previous version.");
    if (!this.workspace.canvas)
      throw new Error("This workspace has no canvas history.");
    restoreCanvas(this.workspace.canvas, index);
    this.state.error = null;
    this.state.metrics = null;
    this.changed();
  }

  async stop() {
    this.stopping = true;
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
