import type { Spec } from "@json-render/core";

export type Message = { id: string; role: "user" | "assistant"; text: string };
export type Workspace = {
  id: string;
  name: string;
  cwd: string;
  threadId: string | null;
  messages: Message[];
  spec: Spec;
};
export type SavedState = {
  version: 1;
  activeId: string;
  model: string;
  workspaces: Workspace[];
};
export type Model = {
  id: string;
  model: string;
  displayName: string;
  isDefault: boolean;
  supportedReasoningEfforts?: { reasoningEffort: string }[];
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
export type Snapshot = SavedState & {
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
  send: (text: string) => Promise<void>;
  interrupt: () => Promise<void>;
  newWorkspace: () => Promise<void>;
  selectWorkspace: (id: string) => Promise<void>;
  chooseFolder: () => Promise<void>;
  setModel: (model: string) => Promise<void>;
  updateData: (
    workspaceId: string,
    path: string,
    value: unknown,
  ) => Promise<void>;
  answer: (allow: boolean, answers?: Record<string, string>) => Promise<void>;
  reconnect: () => Promise<void>;
};

declare global {
  interface Window {
    codexos: Bridge;
  }
}
