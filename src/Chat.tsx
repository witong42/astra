import { ArrowUpIcon, ArrowUpRightIcon, StopIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { ModelControls } from "./ModelControls";
import type { Approval, Snapshot, Workspace } from "./types";

function ApprovalPanel({
  approval,
  onError,
}: {
  approval: Approval;
  onError: (error: unknown) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return (
    <section className="approval" aria-label="Codex request">
      <strong>{approval.summary}</strong>
      {approval.kind === "question" ? (
        approval.questions?.map((question) => (
          <fieldset key={question.id}>
            <legend>{question.question}</legend>
            {question.options.map((option) => (
              <label key={option.label}>
                <input
                  type="radio"
                  name={question.id}
                  value={option.label}
                  checked={answers[question.id] === option.label}
                  onChange={() =>
                    setAnswers({ ...answers, [question.id]: option.label })
                  }
                />
                <span>
                  {option.label}
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
            <input
              aria-label={`Your answer: ${question.header}`}
              placeholder="Your answer"
              value={answers[question.id] ?? ""}
              onChange={(event) =>
                setAnswers({ ...answers, [question.id]: event.target.value })
              }
            />
          </fieldset>
        ))
      ) : (
        <pre>{approval.details}</pre>
      )}
      <div className="approval-actions">
        {approval.kind !== "question" && (
          <button
            type="button"
            onClick={() => window.codexos.answer(false).catch(onError)}
          >
            Decline
          </button>
        )}
        <button
          type="button"
          className="primary"
          onClick={() => window.codexos.answer(true, answers).catch(onError)}
        >
          {approval.kind === "question" ? "Send answer" : "Allow once"}
        </button>
      </div>
    </section>
  );
}

export function Chat({
  snapshot,
  workspace,
  onError,
}: {
  snapshot: Snapshot;
  workspace: Workspace;
  onError: (error: unknown) => void;
}) {
  const history = useRef<HTMLDivElement>(null);
  const busy = snapshot.status === "working";
  const lastText = workspace.messages.at(-1)?.text;
  useEffect(() => {
    if (lastText !== undefined || snapshot.approval)
      history.current?.scrollTo({ top: history.current.scrollHeight });
  }, [lastText, snapshot.approval]);
  return (
    <main className="chat-panel" aria-label="Conversation">
      <div className="chat-header">
        <h2>Conversation</h2>
      </div>
      <div
        className="messages"
        ref={history}
        aria-live="polite"
        aria-relevant="additions text"
      >
        {workspace.messages.length === 0 && (
          <div className="chat-intro">
            <div className="small-mark" aria-hidden="true">
              <ArrowUpRightIcon size={24} />
            </div>
            <h1>What are we making?</h1>
            <p>
              Ask a question, work on your code, or bring an idea to the canvas.
            </p>
          </div>
        )}
        {workspace.messages.map((message, index) => (
          <article className={`message ${message.role}`} key={message.id}>
            <div className="message-author">
              {message.role === "user" ? "You" : "Codex"}
              {message.role === "assistant" &&
                busy &&
                index === workspace.messages.length - 1 && (
                  <span className="working-dot" />
                )}
            </div>
            <div className="message-text">
              {message.text ||
                (busy && index === workspace.messages.length - 1
                  ? snapshot.activity
                  : "Workspace updated.")}
            </div>
          </article>
        ))}
        {snapshot.approval && (
          <ApprovalPanel
            key={snapshot.approval.id}
            approval={snapshot.approval}
            onError={onError}
          />
        )}
      </div>
    </main>
  );
}

export function Composer({
  snapshot,
  onSend,
  onError,
}: {
  snapshot: Snapshot;
  onSend: (text: string) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const [draft, setDraft] = useState("");
  const busy = snapshot.status === "working";
  const send = () => {
    if (!draft.trim() || snapshot.status !== "ready") return;
    onSend(draft.trim())
      .then(() => setDraft(""))
      .catch(onError);
  };
  return (
    <div className="composer-area">
      <div className="composer">
        <textarea
          aria-label="Message Codex"
          placeholder="Ask Codex, or describe a view…"
          value={draft}
          maxLength={24_000}
          rows={3}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              send();
            }
          }}
        />
        <div className="composer-bottom">
          <span>
            <kbd>↵</kbd> Send{" "}
            <span className="composer-hint">· Shift ↵ new line</span>
          </span>
          {busy ? (
            <button
              type="button"
              className="send-button stop"
              aria-label="Stop Codex"
              onClick={() => window.codexos.interrupt().catch(onError)}
            >
              <StopIcon size={12} weight="fill" />
            </button>
          ) : (
            <button
              type="button"
              className="send-button"
              aria-label="Send message"
              disabled={!draft.trim() || snapshot.status !== "ready"}
              onClick={send}
            >
              <ArrowUpIcon size={18} />
            </button>
          )}
        </div>
      </div>
      <ModelControls snapshot={snapshot} onError={onError} />
    </div>
  );
}
