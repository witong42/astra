import { XIcon } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef } from "react";
import { ApprovalPanel, MarkdownMessage } from "./Chat";
import { useLocale } from "./LocaleProvider";
import type { Snapshot, Workspace } from "./types";

const SCROLL_PIN_DISTANCE = 48;
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
  const { language, t } = useLocale();
  const { timeFormat, dayFormat } = useMemo(
    () => ({
      timeFormat: new Intl.DateTimeFormat(
        language === "fr" ? "fr-FR" : "en-GB",
        { hour: "2-digit", minute: "2-digit" },
      ),
      dayFormat: new Intl.DateTimeFormat(
        language === "fr" ? "fr-FR" : "en-GB",
        { day: "numeric", month: "long", year: "numeric" },
      ),
    }),
    [language],
  );
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
    <section className="chat-panel journal-panel" aria-label={t.journalLabel}>
      <div className="chat-header">
        <h2>{t.journal}</h2>
        <button
          type="button"
          className="close-chat"
          aria-label={t.closeJournal}
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
            <p>{t.journalEmpty}</p>
            <span>{t.journalEmptyDetail}</span>
          </div>
        )}
        {entries.map((entry, index) => {
          const previous = entries[index - 1];
          const day = entry.at ? dayFormat.format(entry.at) : t.history;
          const previousDay = previous
            ? previous.at
              ? dayFormat.format(previous.at)
              : t.history
            : null;
          const app = snapshot.workspaces.find(
            (workspace) => workspace.id === entry.workspaceId,
          );
          const author = entry.kind === "user" ? t.you : "Astra";
          const source =
            entry.source === "voice"
              ? t.voice
              : entry.kind === "action"
                ? t.action
                : t.message;
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
                    {entry.status === "failed" ? t.failureDetails : t.details}
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
                      ? t.inProgress
                      : entry.status === "failed"
                        ? t.failed
                        : t.completed}
                  </span>
                )}
              </div>
            </article>
          );
        })}
        {running && (
          <p className="journal-working" role="status">
            <span className="working-dot" /> {t.astraWorking}
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
