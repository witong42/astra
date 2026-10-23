import {
  ArrowUpRightIcon,
  CaretDownIcon,
  FolderSimpleIcon,
  IconContext,
  PlusIcon,
  SidebarSimpleIcon,
  SquaresFourIcon,
  TerminalWindowIcon,
  XIcon,
} from "@phosphor-icons/react";
import { createRef, useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { CanvasHandle } from "./CanvasSurface";
import { Chat, Composer } from "./Chat";
import { Surface } from "./SurfaceView";
import type { Snapshot } from "./types";

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
  const [canvasVisible, setCanvasVisible] = useState(true);
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
  const onWorkspaceError = useCallback((id: string, value: unknown) => {
    const message = value instanceof Error ? value.message : String(value);
    setErrors((previous) => ({ ...previous, [id]: message }));
  }, []);
  const onError = useCallback(
    (value: unknown) => {
      onWorkspaceError(snapshot?.activeId ?? "", value);
    },
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

  if (!snapshot)
    return (
      <div className="launch-screen">
        <div className="brand-mark">&gt;_</div>
        <p>{errors[""] ?? "Opening your workspace…"}</p>
      </div>
    );
  const workspace = snapshot.workspaces.find(
    (entry) => entry.id === snapshot.activeId,
  );
  if (!workspace)
    return <div role="alert">The selected workspace is missing.</div>;
  const busy = snapshot.status === "working";
  const hasSurface = Boolean(
    workspace.canvas
      ? workspace.canvas.generation > 0
      : workspace.spec.root && workspace.spec.elements[workspace.spec.root],
  );
  const error = errors[workspace.id];
  const visibleError = error ?? snapshot.error;
  const folder =
    workspace.cwd.split("/").filter(Boolean).at(-1) ?? workspace.cwd;

  return (
    <div className={`app ${canvasVisible ? "" : "canvas-hidden"}`}>
      <nav className="sidebar" aria-label="Workspaces">
        <div className="traffic-space" />
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            &gt;_
          </div>
          <span>CodexOS</span>
        </div>
        <button
          type="button"
          className="new-workspace"
          onClick={() =>
            afterCapture(() => window.codexos.newWorkspace()).catch(onError)
          }
        >
          <PlusIcon /> New workspace
        </button>
        <div className="sidebar-section-label">Workspaces</div>
        <div className="workspace-list">
          {snapshot.workspaces.map((entry) => (
            <button
              type="button"
              className={`workspace-link ${entry.id === workspace.id ? "active" : ""}`}
              key={entry.id}
              title={entry.name}
              aria-current={entry.id === workspace.id ? "page" : undefined}
              onClick={() =>
                afterCapture(() =>
                  window.codexos.selectWorkspace(entry.id),
                ).catch(onError)
              }
            >
              <span className="workspace-symbol" aria-hidden="true">
                <SquaresFourIcon />
              </span>
              <span className="workspace-name">{entry.name}</span>
              {snapshot.sessions[entry.id]?.busy && (
                <span
                  className={`workspace-activity ${snapshot.sessions[entry.id].approval ? "waiting" : ""}`}
                  role="img"
                  aria-label={snapshot.sessions[entry.id].activity}
                  title={snapshot.sessions[entry.id].activity}
                />
              )}
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <TerminalWindowIcon />
          <div>
            <strong>Codex</strong>
            <span>Local workspace</span>
          </div>
        </div>
      </nav>
      <div className="main-area">
        <header className="toolbar">
          <div className="workspace-breadcrumb">
            <button
              type="button"
              className="folder-button"
              title={workspace.cwd}
              onClick={() =>
                afterCapture(() => window.codexos.chooseFolder()).catch(onError)
              }
            >
              <FolderSimpleIcon /> <span>{folder}</span>
              <CaretDownIcon size={12} />
            </button>
          </div>
          <div className="toolbar-actions">
            <span className="connection-label">
              <span className={`status-dot ${snapshot.status}`} />
              {snapshot.status === "connecting"
                ? "Connecting"
                : snapshot.status === "offline"
                  ? "Disconnected"
                  : busy
                    ? snapshot.activity
                    : "Codex connected"}
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
            <button
              type="button"
              className={`canvas-toggle ${canvasVisible ? "selected" : ""}`}
              aria-pressed={canvasVisible}
              onClick={() => setCanvasVisible(!canvasVisible)}
            >
              <SidebarSimpleIcon /> Canvas
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
                  setErrors((previous) => ({
                    ...previous,
                    [workspace.id]: null,
                  }))
                }
              >
                <XIcon />
              </button>
            )}
          </div>
        )}
        <div className="workspace-body">
          <section className="conversation-main">
            <Chat
              key={workspace.id}
              snapshot={snapshot}
              workspace={workspace}
              onError={onError}
            />
            <footer className="workspace-footer">
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
          </section>
          <aside
            className={`canvas ${canvasVisible ? "" : "hidden"}`}
            aria-label="Live canvas"
          >
            <div className="canvas-heading">
              <span className="canvas-label">
                <span className={`live-indicator ${busy ? "busy" : ""}`} />
                Canvas
              </span>
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
                    Version {workspace.canvas.generation} · Restore…
                  </option>
                  {workspace.canvas.history.map((entry, index) => (
                    <option key={entry.generation} value={index}>
                      Restore version {entry.generation}
                    </option>
                  ))}
                </select>
              )}
              {snapshot.metrics && snapshot.metrics.patches > 0 && (
                <span
                  className="generation-stats"
                  title={`${snapshot.metrics.patches} updates${snapshot.metrics.firstUI === null ? "" : ` · ${(snapshot.metrics.firstUI / 1000).toFixed(1)}s to first view`}`}
                >
                  {snapshot.metrics.total === null
                    ? "Updating canvas…"
                    : "Saved locally"}
                </span>
              )}
            </div>
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
                      patches={
                        snapshot.sessions[entry.id]?.metrics?.patches ?? 0
                      }
                      busy={snapshot.sessions[entry.id]?.busy ?? false}
                      onAsk={(text, id) => {
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
                  <h2>Your live canvas</h2>
                  <p className="empty-description">
                    Build a dashboard, explore an idea, or make something
                    interactive.
                  </p>
                  <div className="starters">
                    {STARTERS.map((starter) => (
                      <button
                        type="button"
                        key={starter.title}
                        disabled={snapshot.status !== "ready"}
                        onClick={() =>
                          onSend(starter.prompt, workspace.id).catch(onError)
                        }
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
          </aside>
        </div>
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
