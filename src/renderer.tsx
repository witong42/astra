import {
  ArrowUpRightIcon,
  ChatCircleDotsIcon,
  FolderSimpleIcon,
  HouseIcon,
  IconContext,
  PlusIcon,
  SquaresFourIcon,
  StarIcon,
  XIcon,
} from "@phosphor-icons/react";
import { createRef, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CanvasHandle } from "./CanvasSurface";
import { Chat, Composer } from "./Chat";
import { HomeScreen } from "./HomeScreen";
import { Surface } from "./SurfaceView";
import { hasWorkspaceSurface } from "./surface";
import type { Snapshot, Workspace } from "./types";
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

function App() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
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
  const afterCapture = useCallback(async (action: () => Promise<void>) => {
    const id = snapshotRef.current?.activeId;
    if (id) await surfaceHandles.current.get(id)?.current?.flush();
    await action();
  }, []);
  const onSend = useCallback(async (text: string, id: string) => {
    const status = snapshotRef.current?.status;
    if (status === "connecting" || status === "offline" || !status)
      throw new Error("Reconnect to Codex before sending a message.");
    setErrors((previous) => ({ ...previous, [id]: null }));
    await surfaceHandles.current.get(id)?.current?.flush();
    await window.codexos.send(text, id);
  }, []);
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
  const approvalId = snapshot?.approval?.id;
  useEffect(() => {
    if (!home && approvalId !== undefined) setChatOpen(true);
  }, [home, approvalId]);
  useEffect(() => {
    if (chatOpen && !home)
      document
        .querySelector<HTMLTextAreaElement>(".composer textarea")
        ?.focus();
  }, [chatOpen, home]);
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
  if (!snapshot)
    return (
      <div className="launch-screen">
        <div className="brand-mark">&gt;_</div>
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
  const favorite = (entry: Workspace) => {
    void window.codexos.setFavorite(entry.id, !entry.favorite).catch(onError);
  };
  return (
    <div className={`desktop-app ${home ? "on-home" : "in-app"}`}>
      <header className="toolbar desktop-toolbar">
        <div className="desktop-navigation">
          {!home && (
            <>
              <button
                type="button"
                className="home-button"
                onClick={() =>
                  void afterCapture(async () => {
                    setHome(true);
                    setChatOpen(false);
                  }).catch(onError)
                }
              >
                <HouseIcon />
                Home
              </button>
              <span className="desktop-divider" />
              <span className="app-title" title={workspace.name}>
                {workspace.name}
              </span>
              <WorkspaceMenu
                workspace={workspace}
                busy={Boolean(snapshot.sessions[workspace.id]?.busy)}
                onRename={window.codexos.renameWorkspace}
                onDelete={deleteApp}
              />
            </>
          )}
        </div>
        <div className="toolbar-actions">
          <span className="connection-label">
            <span className={`status-dot ${snapshot.status}`} />
            {connection}
          </span>
          {snapshot.status === "offline" && (
            <button
              type="button"
              className="text-button"
              onClick={() => window.codexos.reconnect().catch(onError)}
            >
              Reconnect
            </button>
          )}
          {home ? (
            <button type="button" className="new-app-button" onClick={newApp}>
              <PlusIcon />
              New app
            </button>
          ) : (
            <>
              {workspace.canvas && workspace.canvas.history.length > 0 && (
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
              <button
                type="button"
                className="favorite-toggle"
                aria-label={
                  workspace.favorite ? "Remove from Home" : "Add to Home"
                }
                aria-pressed={Boolean(workspace.favorite)}
                disabled={!hasSurface}
                onClick={() => favorite(workspace)}
                title={workspace.favorite ? "Remove from Home" : "Add to Home"}
              >
                <StarIcon weight={workspace.favorite ? "fill" : "regular"} />
              </button>
              <button
                type="button"
                id="chat-toggle"
                className={`chat-toggle ${chatOpen ? "selected" : ""}`}
                aria-expanded={chatOpen}
                aria-controls="chat-drawer"
                onClick={() => (chatOpen ? closeChat() : setChatOpen(true))}
              >
                <ChatCircleDotsIcon />
                Chat{snapshot.approval && <span className="attention-dot" />}
              </button>
            </>
          )}
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
        <aside
          id="chat-drawer"
          className={`conversation-main chat-drawer ${chatOpen && !home ? "open" : ""}`}
          aria-label="Chat"
          aria-hidden={!chatOpen || home}
          inert={!chatOpen || home}
          onKeyDown={(event) => {
            if (
              event.key === "Escape" &&
              !event.defaultPrevented &&
              !event.currentTarget.querySelector(":popover-open")
            )
              closeChat();
          }}
        >
          <Chat
            key={workspace.id}
            snapshot={snapshot}
            workspace={workspace}
            onError={onError}
            onClose={closeChat}
          />
          <footer className="workspace-footer">
            <div className="drawer-folder">
              <button
                type="button"
                title={workspace.cwd}
                onClick={() =>
                  void afterCapture(() => window.codexos.chooseFolder()).catch(
                    onError,
                  )
                }
              >
                <FolderSimpleIcon />
                {workspace.cwd.split("/").filter(Boolean).at(-1) ??
                  workspace.cwd}
              </button>
            </div>
            <Composer
              key={workspace.id}
              snapshot={snapshot}
              draft={drafts[workspace.id] ?? ""}
              onDraftChange={(value) =>
                setDrafts((previous) => ({
                  ...previous,
                  [workspace.id]:
                    typeof value === "function"
                      ? value(previous[workspace.id] ?? "")
                      : value,
                }))
              }
              onSend={(text) => onSend(text, workspace.id)}
              workspaceId={workspace.id}
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
