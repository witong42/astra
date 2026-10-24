import {
  ArrowUpRightIcon,
  FolderSimpleIcon,
  IconContext,
  MicrophoneIcon,
  MicrophoneSlashIcon,
  PlusIcon,
  SidebarSimpleIcon,
  SquaresFourIcon,
  StopIcon,
  XIcon,
} from "@phosphor-icons/react";
import { createRef, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Astra } from "./Astra";
import { type AppController, controlSurface } from "./app-control";
import type { CanvasHandle } from "./CanvasSurface";
import { Composer } from "./Chat";
import { HomeScreen } from "./HomeScreen";
import { Journal } from "./JournalView";
import { Surface } from "./SurfaceView";
import { hasWorkspaceSurface } from "./surface";
import type { Snapshot, Workspace } from "./types";
import { INITIAL_VOICE, type VoiceState } from "./voice";
import { WorkspaceMenu } from "./WorkspaceMenu";

const STARTERS = [
  {
    title: "Plan my week",
    detail: "A board for what matters next",
    prompt:
      "Create a weekly planning workspace with an editable task board (To do, Doing, Done), a short heading and a notes input. Start with an empty task list and a few useful labels. Keep it compact.",
  },
  {
    title: "Compare my options",
    detail: "A clear table and room for notes",
    prompt:
      "Create a decision workspace with a comparison table for three options, an input to name the decision, and a notes field. Label example options clearly as editable examples. Use high-level components and keep it concise.",
  },
  {
    title: "Start from an idea",
    detail: "Tell Codex what you need",
    prompt:
      "Help me shape a new idea. Ask me one useful question first, then we can build an interactive workspace for it.",
  },
];
const CONTROL_TIMEOUT_MS = 5_000;
async function waitForInterface(check: () => boolean) {
  const deadline = Date.now() + CONTROL_TIMEOUT_MS;
  while (!check()) {
    if (Date.now() >= deadline)
      throw new Error("Astra's interface did not finish opening.");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [voice, setVoice] = useState<VoiceState>(INITIAL_VOICE);
  const [home, setHome] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const surfaceHandles = useRef(
    new Map<string, React.RefObject<CanvasHandle | null>>(),
  );
  const surfaceHandle = (id: string) => {
    let handle = surfaceHandles.current.get(id);
    if (!handle) {
      handle = createRef<CanvasHandle>();
      surfaceHandles.current.set(id, handle);
    }
    return handle;
  };
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const previousWorkspace = useRef<string | null>(null);
  const deletedWorkspace = useRef<string | null>(null);
  const onWorkspaceError = useCallback((id: string, value: unknown) => {
    const message = value instanceof Error ? value.message : String(value);
    setErrors((previous) => ({ ...previous, [id]: message }));
  }, []);
  const onError = useCallback(
    (value: unknown) => onWorkspaceError(snapshot?.activeId ?? "", value),
    [snapshot?.activeId, onWorkspaceError],
  );
  const captureWorkspace = useCallback(
    async (id: string) => {
      try {
        await surfaceHandles.current.get(id)?.current?.flush();
      } catch (error) {
        onWorkspaceError(
          id,
          `Canvas changes could not be saved: ${error instanceof Error ? error.message : String(error)} Chat remains available using the last saved canvas.`,
        );
      }
    },
    [onWorkspaceError],
  );
  const afterCapture = useCallback(
    async (action: () => Promise<void>) => {
      const id = snapshotRef.current?.activeId;
      if (id) await captureWorkspace(id);
      await action();
    },
    [captureWorkspace],
  );
  const returnHome = useCallback(
    () =>
      afterCapture(async () => {
        setHome(true);
        setChatOpen(false);
      }),
    [afterCapture],
  );
  const onSend = useCallback(
    async (text: string, id: string) => {
      const status = snapshotRef.current?.status;
      if (status === "connecting" || status === "offline" || !status)
        throw new Error("Reconnect to Codex before sending a message.");
      setErrors((previous) => ({ ...previous, [id]: null }));
      await captureWorkspace(id);
      await window.codexos.send(text, id);
    },
    [captureWorkspace],
  );
  useEffect(() => {
    const unsubscribe = window.codexos.subscribeVoice(setVoice);
    window.codexos.voiceSnapshot().then(setVoice).catch(onError);
    return unsubscribe;
  }, [onError]);
  const toggleVoice = useCallback(() => {
    void window.codexos.startVoice().catch(onError);
  }, [onError]);
  const pauseVoice = useCallback(() => {
    void window.codexos.stopVoice().catch(onError);
  }, [onError]);
  const interruptVoice = useCallback(() => {
    void window.codexos.interruptVoice().catch(onError);
  }, [onError]);
  useEffect(() => {
    const interrupt = (event: KeyboardEvent) => {
      if (
        home &&
        voice.active &&
        event.key === "Escape" &&
        !event.defaultPrevented
      ) {
        event.preventDefault();
        interruptVoice();
      }
    };
    addEventListener("keydown", interrupt);
    return () => removeEventListener("keydown", interrupt);
  }, [home, voice.active, interruptVoice]);
  useEffect(() => {
    window.codexosFlush = async () => {
      await Promise.all(
        [...surfaceHandles.current.values()].map((handle) =>
          handle.current?.flush(),
        ),
      );
    };
    const unsubscribe = window.codexos.subscribe(setSnapshot);
    window.codexos
      .snapshot()
      .then(setSnapshot)
      .catch((error) => onWorkspaceError("", error));
    return unsubscribe;
  }, [onWorkspaceError]);
  useEffect(() => {
    const id = snapshot?.activeId;
    if (id && previousWorkspace.current && previousWorkspace.current !== id) {
      if (previousWorkspace.current === deletedWorkspace.current) {
        deletedWorkspace.current = null;
        setHome(true);
        setChatOpen(false);
        previousWorkspace.current = id;
        return;
      }
      setHome(false);
      const next = snapshotRef.current?.workspaces.find(
        (workspace) => workspace.id === id,
      );
      setChatOpen(
        Boolean(snapshotRef.current?.sessions[id]?.approval) ||
          Boolean(next && !hasWorkspaceSurface(next)),
      );
    }
    if (id) previousWorkspace.current = id;
  }, [snapshot?.activeId]);
  const approvalId = Object.values(snapshot?.sessions ?? {})
    .map((session) => session.approval?.id ?? "")
    .filter(Boolean)
    .join(",");
  useEffect(() => {
    if (approvalId) setChatOpen(true);
  }, [approvalId]);
  useEffect(() => {
    if (chatOpen)
      document
        .querySelector<HTMLTextAreaElement>(".composer textarea")
        ?.focus();
  }, [chatOpen]);
  const closeChat = () => {
    setChatOpen(false);
    document.getElementById("chat-toggle")?.focus();
  };
  const openWorkspace = (workspace: Workspace) => {
    void afterCapture(async () => {
      const currentId = snapshotRef.current?.activeId;
      await window.codexos.selectWorkspace(workspace.id);
      if (currentId === workspace.id) {
        setHome(false);
        setChatOpen(
          Boolean(snapshotRef.current?.sessions[workspace.id]?.approval) ||
            !hasWorkspaceSurface(workspace),
        );
      }
    }).catch(onError);
  };
  const newApp = () => {
    void afterCapture(async () => {
      await window.codexos.newWorkspace();
    }).catch(onError);
  };
  const deleteApp = async (id: string) => {
    const active = snapshotRef.current?.activeId === id;
    if (active) deletedWorkspace.current = id;
    try {
      if (!(await window.codexos.deleteWorkspace(id))) {
        deletedWorkspace.current = null;
        return;
      }
      surfaceHandles.current.delete(id);
      setDrafts((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
      setErrors((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
    } catch (error) {
      deletedWorkspace.current = null;
      throw error;
    }
  };
  useEffect(() => {
    const control: AppController = async (request) => {
      if (request.action === "status")
        return {
          screen: home ? "home" : "app",
          activeApp: snapshotRef.current?.activeId ?? null,
        };
      if (request.action === "home") {
        await returnHome();
        await waitForInterface(() =>
          Boolean(document.querySelector(".home-screen")),
        );
        return { screen: "home" };
      }
      const id = request.id;
      await afterCapture(async () => {
        await window.codexos.selectWorkspace(id);
        setHome(false);
        setChatOpen(false);
      });
      await waitForInterface(
        () =>
          document.querySelector<HTMLElement>(".app-stage:not([inert])")
            ?.dataset.workspaceId === id,
      );
      if (request.action === "open") return { screen: "app", activeApp: id };
      await waitForInterface(() => {
        const current = surfaceHandles.current.get(id)?.current;
        const canvas = snapshotRef.current?.workspaces.find(
          (workspace) => workspace.id === id,
        )?.canvas;
        return !canvas || Boolean(current && current.isReady?.() !== false);
      });
      const surface = surfaceHandles.current.get(id)?.current;
      const root = document.querySelector<HTMLElement>(
        ".generated-surface:not(.background-surface)",
      );
      if (!root)
        throw new Error("This app has no rendered interface to inspect.");
      const result = surface?.control
        ? await surface.control(request)
        : controlSurface(root, request);
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      );
      await surface?.flush();
      return result;
    };
    window.astraControl = control;
    return () => {
      if (window.astraControl === control) delete window.astraControl;
    };
  }, [home, afterCapture, returnHome]);
  if (!snapshot)
    return (
      <div className="launch-screen">
        <img className="launch-icon" src="./icon.png" alt="" />
        <p>{errors[""] ?? "Opening your apps…"}</p>
      </div>
    );
  const workspace = snapshot.workspaces.find(
    (entry) => entry.id === snapshot.activeId,
  );
  if (!workspace)
    return <div role="alert">The selected workspace is missing.</div>;
  const busy = snapshot.status === "working";
  const hasSurface = hasWorkspaceSurface(workspace);
  const error = errors[workspace.id];
  const visibleError = error ?? snapshot.error;
  const running = Object.values(snapshot.sessions).filter(
    (session) => session.busy,
  ).length;
  const connection =
    snapshot.status === "connecting"
      ? "Connecting"
      : snapshot.status === "offline"
        ? "Disconnected"
        : home && running
          ? `${running} working`
          : busy
            ? snapshot.activity
            : "Codex connected";
  const favorite = (entry: Workspace) =>
    window.codexos.setFavorite(entry.id, !entry.favorite);
  const conversationWorkspace = home ? snapshot.assistant : workspace;
  const conversationId = conversationWorkspace?.id ?? workspace.id;
  const conversationSession = snapshot.sessions[conversationId];
  const conversationSnapshot: Snapshot = {
    ...snapshot,
    status:
      snapshot.status === "offline" || snapshot.status === "connecting"
        ? snapshot.status
        : conversationSession?.busy
          ? "working"
          : "ready",
    activity: conversationSession?.activity ?? "Ready",
    approval: conversationSession?.approval ?? null,
    error: conversationSession?.error ?? null,
    metrics: conversationSession?.metrics ?? null,
  };
  const draftId = home ? "assistant" : workspace.id;
  const voiceWorking =
    voice.status === "speaking" || voice.status === "thinking";
  return (
    <div className={`desktop-app ${home ? "on-home" : "in-app"}`}>
      <header className="toolbar desktop-toolbar">
        <div className="desktop-navigation">
          {!home && (
            <span className="app-title" title={workspace.name}>
              {workspace.name}
            </span>
          )}
        </div>
        <div className="toolbar-actions">
          {snapshot.status === "offline" && (
            <button
              type="button"
              className="text-button"
              onClick={() => window.codexos.reconnect().catch(onError)}
            >
              Reconnect
            </button>
          )}
          <button
            type="button"
            id="chat-toggle"
            className={`chat-toggle journal-toggle ${chatOpen ? "selected" : ""}`}
            aria-label="Ouvrir le journal"
            aria-expanded={chatOpen}
            aria-controls="chat-drawer"
            onClick={() => (chatOpen ? closeChat() : setChatOpen(true))}
          >
            <SidebarSimpleIcon />
            {approvalId && <span className="attention-dot" />}
          </button>
        </div>
      </header>
      {visibleError && (
        <div className="error-banner" role="alert">
          <span>{visibleError}</span>
          {error && (
            <button
              type="button"
              aria-label="Dismiss error"
              onClick={() =>
                setErrors((previous) => ({ ...previous, [workspace.id]: null }))
              }
            >
              <XIcon />
            </button>
          )}
        </div>
      )}
      <div className="desktop-body">
        {home && (
          <HomeScreen
            snapshot={snapshot}
            onOpen={openWorkspace}
            onFavorite={favorite}
            onRename={window.codexos.renameWorkspace}
            onDelete={deleteApp}
            voice={voice}
            onToggleVoice={toggleVoice}
          />
        )}
        <section
          className={`canvas app-stage ${home ? "parked" : ""}`}
          data-workspace-id={workspace.id}
          aria-label="Live canvas"
          aria-hidden={home}
          inert={home}
        >
          <div className="canvas-content">
            {snapshot.workspaces
              .filter(
                (entry) =>
                  entry.id === workspace.id ||
                  snapshot.sessions[entry.id]?.busy ||
                  entry.canvas?.pending.length,
              )
              .map((entry) => (
                <div
                  key={entry.id}
                  className={`generated-surface ${entry.id === workspace.id && hasSurface ? "" : "background-surface"}`}
                  aria-hidden={entry.id !== workspace.id || !hasSurface}
                  inert={entry.id !== workspace.id || !hasSurface}
                >
                  <Surface
                    workspace={entry}
                    patches={snapshot.sessions[entry.id]?.metrics?.patches ?? 0}
                    busy={snapshot.sessions[entry.id]?.busy ?? false}
                    onAsk={(text, id) => {
                      if (id === workspace.id && !home) setChatOpen(true);
                      void onSend(text, id).catch((error) =>
                        onWorkspaceError(id, error),
                      );
                    }}
                    onError={onWorkspaceError}
                    handle={surfaceHandle(entry.id)}
                  />
                </div>
              ))}
            {!hasSurface && (
              <div className="empty-workspace">
                <div className="workspace-emblem" aria-hidden="true">
                  <SquaresFourIcon size={28} weight="light" />
                </div>
                <h2>What will you make?</h2>
                <p className="empty-description">
                  Describe an app in chat. Your canvas will take it from here.
                </p>
                <div className="starters">
                  {STARTERS.map((starter) => (
                    <button
                      type="button"
                      key={starter.title}
                      disabled={snapshot.status !== "ready"}
                      onClick={() => {
                        setChatOpen(true);
                        void onSend(starter.prompt, workspace.id).catch(
                          onError,
                        );
                      }}
                    >
                      <span>
                        <strong>{starter.title}</strong>
                        <small>{starter.detail}</small>
                      </span>
                      <span className="starter-arrow" aria-hidden="true">
                        <ArrowUpRightIcon />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
        {!home && (
          <div className="floating-astra">
            <Astra
              voice={voice}
              compact
              onToggle={() => void returnHome().catch(onError)}
            />
          </div>
        )}
        <aside
          id="chat-drawer"
          className={`conversation-main chat-drawer journal-drawer ${chatOpen ? "open" : ""}`}
          aria-label="Journal"
          aria-hidden={!chatOpen}
          inert={!chatOpen}
          onKeyDown={(event) => {
            if (
              event.key === "Escape" &&
              !event.defaultPrevented &&
              !event.currentTarget.querySelector(":popover-open")
            ) {
              event.preventDefault();
              event.stopPropagation();
              closeChat();
            }
          }}
        >
          <Journal
            snapshot={snapshot}
            onOpen={openWorkspace}
            onError={onError}
            onClose={closeChat}
          />
          <footer className="workspace-footer">
            <div className="journal-tools">
              <button
                type="button"
                onClick={voice.active ? pauseVoice : toggleVoice}
                title={voice.active ? "Désactiver le micro" : "Activer la voix"}
                aria-label={
                  voice.active ? "Désactiver le micro" : "Activer la voix"
                }
              >
                {voice.active ? <MicrophoneIcon /> : <MicrophoneSlashIcon />}
              </button>
              {voiceWorking && (
                <button
                  type="button"
                  onClick={interruptVoice}
                  aria-label="Interrompre Astra"
                >
                  <StopIcon />
                </button>
              )}
              <button
                type="button"
                onClick={newApp}
                title="Créer une mini-app"
                aria-label="Créer une mini-app"
              >
                <PlusIcon />
              </button>
              {!home && (
                <WorkspaceMenu
                  workspace={workspace}
                  busy={busy}
                  onRename={window.codexos.renameWorkspace}
                  onDelete={deleteApp}
                  onFavorite={
                    hasSurface ? () => favorite(workspace) : undefined
                  }
                />
              )}
              {!home &&
                workspace.canvas &&
                workspace.canvas.history.length > 0 && (
                  <select
                    className="version-picker"
                    aria-label="Restore canvas version"
                    value=""
                    disabled={busy || workspace.canvas.pending.length > 0}
                    onChange={(event) => {
                      const index = Number(event.currentTarget.value);
                      void afterCapture(() =>
                        window.codexos.restoreCanvas(index, workspace.id),
                      ).catch(onError);
                    }}
                  >
                    <option value="">
                      Version {workspace.canvas.generation}
                    </option>
                    {workspace.canvas.history.map((entry, index) => (
                      <option key={entry.generation} value={index}>
                        Restore version {entry.generation}
                      </option>
                    ))}
                  </select>
                )}
              <span className="journal-connection" title={connection}>
                <span className={`status-dot ${snapshot.status}`} />
              </span>
            </div>
            {!home && (
              <div className="drawer-folder">
                <button
                  type="button"
                  title={workspace.cwd}
                  onClick={() =>
                    void afterCapture(() =>
                      window.codexos.chooseFolder(),
                    ).catch(onError)
                  }
                >
                  <FolderSimpleIcon />
                  {workspace.cwd.split("/").filter(Boolean).at(-1) ??
                    workspace.cwd}
                </button>
              </div>
            )}
            <p className="journal-compose-context">
              {home ? "Parler à Astra" : workspace.name}
            </p>
            <Composer
              key={draftId}
              snapshot={conversationSnapshot}
              draft={drafts[draftId] ?? ""}
              onDraftChange={(value) =>
                setDrafts((previous) => ({
                  ...previous,
                  [draftId]:
                    typeof value === "function"
                      ? value(previous[draftId] ?? "")
                      : value,
                }))
              }
              onSend={async (text) => {
                if (home) {
                  await captureWorkspace(workspace.id);
                  await window.codexos.sendAssistant(text);
                } else await onSend(text, workspace.id);
              }}
              workspaceId={conversationId}
              onError={onError}
            />
          </footer>
        </aside>
      </div>
    </div>
  );
}

const container = document.getElementById("root");
if (container)
  createRoot(container).render(
    <IconContext.Provider
      value={{ size: 16, weight: "regular", "aria-hidden": true }}
    >
      <App />
    </IconContext.Provider>,
  );
