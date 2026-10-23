import { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
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
  const [error, setError] = useState<string | null>(null);
  const [canvasVisible, setCanvasVisible] = useState(true);
  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  const onError = useCallback(
    (value: unknown) =>
      setError(value instanceof Error ? value.message : String(value)),
    [],
  );
  const onSend = useCallback(
    (text: string) => {
      if (snapshotRef.current?.status !== "ready") {
        setError("Wait for Codex to finish or reconnect first.");
        return;
      }
      setError(null);
      window.codexos.send(text).catch(onError);
    },
    [onError],
  );

  useEffect(() => {
    const unsubscribe = window.codexos.subscribe(setSnapshot);
    window.codexos.snapshot().then(setSnapshot).catch(onError);
    return unsubscribe;
  }, [onError]);

  if (!snapshot)
    return (
      <div className="launch-screen">
        <div className="brand-mark">&gt;_</div>
        <p>{error ?? "Opening your workspace…"}</p>
      </div>
    );
  const workspace = snapshot.workspaces.find(
    (entry) => entry.id === snapshot.activeId,
  );
  if (!workspace)
    return <div role="alert">The selected workspace is missing.</div>;
  const busy = snapshot.status === "working";
  const hasSurface = Boolean(
    workspace.spec.root && workspace.spec.elements[workspace.spec.root],
  );
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
          disabled={busy}
          onClick={() => window.codexos.newWorkspace().catch(onError)}
        >
          <span>＋</span> New workspace
        </button>
        <div className="sidebar-section-label">YOUR WORKSPACES</div>
        <div className="workspace-list">
          {snapshot.workspaces.map((entry) => (
            <button
              type="button"
              className={`workspace-link ${entry.id === workspace.id ? "active" : ""}`}
              key={entry.id}
              disabled={busy && entry.id !== workspace.id}
              onClick={() =>
                window.codexos.selectWorkspace(entry.id).catch(onError)
              }
            >
              <span className="workspace-symbol" aria-hidden="true">
                {entry.spec.root ? "▦" : "◇"}
              </span>
              <span>{entry.name}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="account-avatar">W</div>
          <div>
            <strong>Your workspace</strong>
            <span>Local · Personal</span>
          </div>
          <span
            className={`status-dot ${snapshot.status}`}
            role="img"
            aria-label={snapshot.status}
          />
        </div>
      </nav>
      <div className="main-area">
        <header className="toolbar">
          <div className="workspace-breadcrumb">
            <button
              type="button"
              className="folder-button"
              disabled={busy}
              title={workspace.cwd}
              onClick={() => window.codexos.chooseFolder().catch(onError)}
            >
              <span aria-hidden="true">⌑</span> {folder}{" "}
              <span aria-hidden="true">⌄</span>
            </button>
            <span className="breadcrumb-divider">/</span>
            <span className="current-title">
              {workspace.messages.length ? "Workspace" : "New workspace"}
            </span>
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
              Canvas <span aria-hidden="true">◧</span>
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
                onClick={() => setError(null)}
              >
                ×
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
                onSend={onSend}
                onError={onError}
              />
            </footer>
          </section>
          {canvasVisible && (
            <aside className="canvas" aria-label="Live canvas">
              <div className="canvas-heading">
                <span className="eyebrow">
                  <span className={`live-indicator ${busy ? "busy" : ""}`} />
                  LIVE WORKSPACE
                </span>
                {snapshot.metrics && snapshot.metrics.patches > 0 && (
                  <span className="generation-stats">
                    {snapshot.metrics.firstUI !== null &&
                      `${(snapshot.metrics.firstUI / 1000).toFixed(1)}s to first view`}
                    <span> · </span>
                    {snapshot.metrics.patches} updates
                    {snapshot.metrics.total !== null
                      ? " · Saved locally"
                      : " · Streaming"}
                  </span>
                )}
              </div>
              {hasSurface ? (
                <div className="generated-surface">
                  <Surface
                    key={workspace.id}
                    workspace={workspace}
                    patches={snapshot.metrics?.patches ?? 0}
                    busy={busy}
                    onAsk={onSend}
                    onError={onError}
                  />
                </div>
              ) : (
                <div className="empty-workspace">
                  <div className="workspace-emblem" aria-hidden="true">
                    <span>↗</span>
                  </div>
                  <p className="eyebrow">SHAPED BY CONVERSATION</p>
                  <h2>Your live canvas</h2>
                  <p className="empty-description">
                    A conversation can become a plan, a table, a dashboard.
                    <br />
                    Describe what you need. Your workspace takes shape here.
                  </p>
                  <div className="starters">
                    {STARTERS.map((starter) => (
                      <button
                        type="button"
                        key={starter.title}
                        disabled={snapshot.status !== "ready"}
                        onClick={() => onSend(starter.prompt)}
                      >
                        <span>
                          <strong>{starter.title}</strong>
                          <small>{starter.detail}</small>
                        </span>
                        <span className="starter-arrow" aria-hidden="true">
                          ↗
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="empty-footnote">
                    Built around your work. Changed by conversation.
                  </p>
                </div>
              )}
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

const container = document.getElementById("root");
if (container) createRoot(container).render(<App />);
