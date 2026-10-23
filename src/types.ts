import type { Spec } from "@json-render/core";
import type { CanvasAck, CanvasState } from "./canvas";

export type Message = { id: string; role: "user" | "assistant"; text: string };
export type Workspace = {
  id: string;
  name: string;
  cwd: string;
  threadId: string | null;
  messages: Message[];
  spec: Spec;
  canvas: CanvasState | null;
};
export type SavedState = {
  version: 1;
  activeId: string;
  model: string;
  reasoningEffort: string;
  serviceTier: string;
  workspaces: Workspace[];
};
export type Model = {
  id: string;
  model: string;
  displayName: string;
  isDefault: boolean;
  supportedReasoningEfforts?: {
    reasoningEffort: string;
    description?: string;
  }[];
  defaultReasoningEffort?: string;
  serviceTiers?: { id: string; name: string; description: string }[];
};
export type Question = {
  id: string;
  header: string;
  question: string;
  options: { label: string; description: string }[];
};
export type Approval = {
  id: string | number;
  kind: "command" | "file" | "question" | "permissions";
  summary: string;
  details: string;
  questions?: Question[];
};
export type Metrics = {
  startedAt: number;
  firstUI: number | null;
  total: number | null;
  patches: number;
};
export type SessionStatus = {
  busy: boolean;
  activity: string;
  approval: Approval | null;
  error: string | null;
  metrics: Metrics | null;
  settings: {
    model: string;
    reasoningEffort: string;
    serviceTier: string;
  } | null;
};
export type Snapshot = SavedState & {
  sessions: Record<string, SessionStatus>;
  status: "connecting" | "ready" | "working" | "offline";
  activity: string;
  account: string;
  backendVersion: string;
  models: Model[];
  approval: Approval | null;
  error: string | null;
  metrics: Metrics | null;
};
export type Bridge = {
  snapshot: () => Promise<Snapshot>;
  subscribe: (listener: (snapshot: Snapshot) => void) => () => void;
  send: (text: string, workspaceId?: string) => Promise<void>;
  interrupt: (workspaceId?: string) => Promise<void>;
  newWorkspace: () => Promise<void>;
  selectWorkspace: (id: string) => Promise<void>;
  chooseFolder: () => Promise<void>;
  setModel: (model: string) => Promise<void>;
  setReasoningEffort: (effort: string) => Promise<void>;
  setServiceTier: (tier: string) => Promise<void>;
  updateData: (
    workspaceId: string,
    path: string,
    value: unknown,
  ) => Promise<void>;
  updateCanvas: (workspaceId: string, ack: CanvasAck) => Promise<void>;
  updateOpenUI: (
    workspaceId: string,
    generation: number,
    state: Record<string, unknown>,
  ) => Promise<void>;
  restoreCanvas: (index: number, workspaceId?: string) => Promise<void>;
  answer: (
    allow: boolean,
    answers?: Record<string, string>,
    workspaceId?: string,
    approvalId?: string | number,
  ) => Promise<void>;
  reconnect: () => Promise<void>;
  openExternal: (url: string) => Promise<void>;
};

declare global {
  interface Window {
    codexos: Bridge;
    codexosFlush: () => Promise<void>;
  }
}
