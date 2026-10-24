import { XIcon } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { ApprovalPanel, MarkdownMessage } from "./Chat";
import type { Snapshot, Workspace } from "./types";

const SCROLL_PIN_DISTANCE = 48;
const timeFormat = new Intl.DateTimeFormat("fr-FR", {
  hour: "2-digit",
  minute: "2-digit",
});
const dayFormat = new Intl.DateTimeFormat("fr-FR", {
  day: "numeric",
  month: "long",
  year: "numeric",
});
export function Journal({
  snapshot,
  onClose,
  onOpen,
  onError,
}: {
  snapshot: Snapshot;
  onClose: () => void;
  onOpen: (workspace: Workspace) => void;
  onError: (error: unknown) => void;
}) {
  const history = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const entries = snapshot.journal ?? [];
  const pending = Object.entries(snapshot.sessions).filter(
    ([, session]) => session.approval,
  );
  const running = Object.values(snapshot.sessions).some(
    (session) => session.busy,
  );
  useEffect(() => {
    if (pinned.current)
      history.current?.scrollTo({ top: history.current.scrollHeight });
  });
  return (
    <section className="chat-panel journal-panel" aria-label="Journal continu">
      <div className="chat-header">
        <h2>Journal</h2>
        <button
          type="button"
          className="close-chat"
          aria-label="Fermer le journal"
          onClick={onClose}
        >
          <XIcon />
        </button>
      </div>
      <div
        className="messages journal-history"
        ref={history}
        onScroll={() => {
          const element = history.current;
          if (element)
            pinned.current =
              element.scrollHeight - element.scrollTop - element.clientHeight <
              SCROLL_PIN_DISTANCE;
        }}
      >
        {!entries.length && (
          <div className="journal-empty">
            <p>Le fil de ce qu’on fait ensemble.</p>
            <span>Nos échanges et les actions d’Astra apparaîtront ici.</span>
          </div>
        )}
        {entries.map((entry, index) => {
          const previous = entries[index - 1];
          const day = entry.at ? dayFormat.format(entry.at) : "Historique";
          const previousDay = previous
            ? previous.at
              ? dayFormat.format(previous.at)
              : "Historique"
            : null;
          const app = snapshot.workspaces.find(
            (workspace) => workspace.id === entry.workspaceId,
          );
          const author = entry.kind === "user" ? "Toi" : "Astra";
          const source =
            entry.source === "voice"
              ? "voix"
              : entry.kind === "action"
                ? "action"
                : "message";
          return (
            <article
              className={`journal-entry message ${entry.kind} ${entry.status ?? ""}`}
              key={entry.id}
            >
              {day !== previousDay && <h3 className="journal-day">{day}</h3>}
              <div className="journal-meta">
                <span>
                  {author} <span className="journal-source">· {source}</span>
                </span>
                {entry.at > 0 && (
                  <time dateTime={new Date(entry.at).toISOString()}>
                    {timeFormat.format(entry.at)}
                  </time>
                )}
              </div>
              <div className="message-text">
                <MarkdownMessage text={entry.text} onError={onError} />
              </div>
              {entry.detail && (
                <details className="journal-detail">
                  <summary>
                    {entry.status === "failed"
                      ? "Détail de l’échec"
                      : "Détails"}
                  </summary>
                  <pre>{entry.detail}</pre>
                </details>
              )}
              <div className="journal-entry-footer">
                {app && (
                  <button
                    type="button"
                    className="journal-app"
                    onClick={() => onOpen(app)}
                  >
                    {app.name}
                  </button>
                )}
                {entry.status && (
                  <span className={`journal-result ${entry.status}`}>
                    {entry.status === "running"
                      ? "En cours"
                      : entry.status === "failed"
                        ? "Non aboutie"
                        : "Effectuée"}
                  </span>
                )}
              </div>
            </article>
          );
        })}
        {running && (
          <p className="journal-working" role="status">
            <span className="working-dot" /> Astra travaille…
          </p>
        )}
        {pending.map(
          ([id, session]) =>
            session.approval && (
              <ApprovalPanel
                key={`${id}:${session.approval.id}`}
                approval={session.approval}
                workspaceId={id}
                onError={onError}
              />
            ),
        )}
      </div>
    </section>
  );
}
