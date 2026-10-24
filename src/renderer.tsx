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
import { LocaleProvider, useLocale } from "./LocaleProvider";
import { getCopy, INTERFACE_LANGUAGES } from "./locale";
import { Surface } from "./SurfaceView";
import { hasWorkspaceSurface } from "./surface";
import type { Snapshot, Workspace } from "./types";
import { APP_RELEASE } from "./version";
import { INITIAL_VOICE, type VoiceState } from "./voice";
import { WorkspaceMenu } from "./WorkspaceMenu";

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
  const { language, t, setLanguage } = useLocale();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [voice, setVoice] = useState<VoiceState>(INITIAL_VOICE);
  const [remoteActive, setRemoteActive] = useState(false);
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
          getCopy().canvasSaveFailed(
            error instanceof Error ? error.message : String(error),
          ),
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
        throw new Error(getCopy().reconnectBeforeSend);
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
    const unsubscribe = window.codexos.subscribeRemoteActive?.(setRemoteActive);
    void window.codexos.remoteActive?.().then(setRemoteActive).catch(onError);
    return unsubscribe;
  }, [onError]);
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
        ?.focus({ preventScroll: true });
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
          audio: await window.codexos.audioStatus?.(),
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
  if (remoteActive)
    return (
      <main className="launch-screen" role="status">
        <p>{t.phoneActive}</p>
        <p>{t.closePhoneTab}</p>
        <small>{APP_RELEASE}</small>
      </main>
    );
  if (!snapshot)
    return (
      <div className="launch-screen">
        <img className="launch-icon" src="./icon.png" alt="" />
        <p>{errors[""] ?? t.openingApps}</p>
      </div>
    );
  const workspace = snapshot.workspaces.find(
    (entry) => entry.id === snapshot.activeId,
  );
  if (!workspace) return <div role="alert">{t.appMissing}</div>;
  const busy = snapshot.status === "working";
  const hasSurface = hasWorkspaceSurface(workspace);
  const error = errors[workspace.id];
  const visibleError = error ?? snapshot.error;
  const running = Object.values(snapshot.sessions).filter(
    (session) => session.busy,
  ).length;
  const connection =
    snapshot.status === "connecting"
      ? t.connecting
      : snapshot.status === "offline"
        ? t.disconnected
        : home && running
          ? t.backgroundTasks(running)
          : busy
            ? t.working
            : t.connected;
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
              {t.reconnect}
            </button>
          )}
          <fieldset
            className="language-switch"
            aria-label={t.interfaceLanguage}
          >
            {INTERFACE_LANGUAGES.map((choice) => (
              <button
                key={choice}
                type="button"
                lang={choice}
                aria-label={choice === "fr" ? "Français" : "English"}
                aria-pressed={language === choice}
                onClick={() => {
                  try {
                    setLanguage(choice);
                  } catch (error) {
                    onError(error);
                  }
                }}
              >
                {choice.toUpperCase()}
              </button>
            ))}
          </fieldset>
          <button
            type="button"
            id="chat-toggle"
            className={`chat-toggle journal-toggle ${chatOpen ? "selected" : ""}`}
            aria-label={chatOpen ? t.closeJournal : t.openJournal}
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
              aria-label={t.dismissError}
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
          aria-label={t.liveCanvas}
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
                <h2>{t.emptyTitle}</h2>
                <p className="empty-description">{t.emptyDescription}</p>
                <div className="starters">
                  {[
                    {
                      title: t.planWeek,
                      detail: t.planWeekDetail,
                      prompt: t.planWeekPrompt,
                    },
                    {
                      title: t.compareOptions,
                      detail: t.compareOptionsDetail,
                      prompt: t.compareOptionsPrompt,
                    },
                    {
                      title: t.startIdea,
                      detail: t.startIdeaDetail,
                      prompt: t.startIdeaPrompt,
                    },
                  ].map((starter) => (
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
          aria-label={t.journal}
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
                title={voice.active ? t.disableMicrophone : t.enableVoice}
                aria-label={voice.active ? t.disableMicrophone : t.enableVoice}
              >
                {voice.active ? <MicrophoneIcon /> : <MicrophoneSlashIcon />}
              </button>
              {voiceWorking && (
                <button
                  type="button"
                  onClick={interruptVoice}
                  aria-label={t.interruptAstra}
                >
                  <StopIcon />
                </button>
              )}
              <button
                type="button"
                onClick={newApp}
                title={t.createApp}
                aria-label={t.createApp}
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
                    aria-label={t.restoreCanvas}
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
                      {t.version(workspace.canvas.generation)}
                    </option>
                    {workspace.canvas.history.map((entry, index) => (
                      <option key={entry.generation} value={index}>
                        {t.restoreVersion(entry.generation)}
                      </option>
                    ))}
                  </select>
                )}
              <span
                className="journal-connection"
                title={`${connection} · ${APP_RELEASE}`}
              >
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
              {home ? t.talkAstra : workspace.name}
              <small className="app-release">{APP_RELEASE}</small>
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
      <LocaleProvider>
        <App />
      </LocaleProvider>
    </IconContext.Provider>,
  );
