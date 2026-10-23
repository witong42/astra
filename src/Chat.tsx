import {
  ArrowUpIcon,
  ArrowUpRightIcon,
  StopIcon,
  XIcon,
} from "@phosphor-icons/react";
import {
  type Dispatch,
  memo,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { ModelControls } from "./ModelControls";
import { externalWebUrl } from "./navigation";
import type { Approval, Snapshot, Workspace } from "./types";

const MARKDOWN_PLUGINS = [remarkGfm];
function markdownUrl(url: string, key: string) {
  if (key === "href" && url.startsWith("#")) return url;
  try {
    return externalWebUrl(url);
  } catch {
    return "";
  }
}
const MarkdownMessage = memo(function MarkdownMessage({
  text,
  onError,
}: {
  text: string;
  onError: (error: unknown) => void;
}) {
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children }) =>
        href ? (
          <a
            href={href}
            onClick={(event) => {
              event.preventDefault();
              try {
                if (href.startsWith("#")) {
                  const target = document.getElementById(
                    decodeURIComponent(href.slice(1)),
                  );
                  target?.scrollIntoView({ block: "nearest" });
                  target?.focus();
                } else window.codexos.openExternal(href).catch(onError);
              } catch (error) {
                onError(error);
              }
            }}
          >
            {children}
          </a>
        ) : (
          children
        ),
      img: ({ alt, src }) =>
        src ? (
          <a
            href={src}
            onClick={(event) => {
              event.preventDefault();
              window.codexos.openExternal(src).catch(onError);
            }}
          >
            {alt || "Image"}
          </a>
        ) : (
          <span>{alt || "Image"}</span>
        ),
      table: ({ children }) => (
        <div className="markdown-table">
          <table>{children}</table>
        </div>
      ),
    }),
    [onError],
  );
  return (
    <Markdown
      remarkPlugins={MARKDOWN_PLUGINS}
      urlTransform={markdownUrl}
      components={components}
    >
      {text}
    </Markdown>
  );
});

export function ApprovalPanel({
  approval,
  workspaceId,
  onError,
}: {
  approval: Approval;
  workspaceId: string;
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
            onClick={() =>
              window.codexos
                .answer(false, undefined, workspaceId, approval.id)
                .catch(onError)
            }
          >
            Decline
          </button>
        )}
        <button
          type="button"
          className="primary"
          onClick={() =>
            window.codexos
              .answer(true, answers, workspaceId, approval.id)
              .catch(onError)
          }
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
  onClose,
}: {
  snapshot: Snapshot;
  workspace: Workspace;
  onError: (error: unknown) => void;
  onClose?: () => void;
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
        {onClose && (
          <button
            type="button"
            className="close-chat"
            aria-label="Close chat"
            onClick={onClose}
          >
            <XIcon />
          </button>
        )}
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
              <MarkdownMessage
                onError={onError}
                text={
                  message.text ||
                  (busy && index === workspace.messages.length - 1
                    ? snapshot.activity
                    : "Workspace updated.")
                }
              />
            </div>
          </article>
        ))}
        {snapshot.approval && (
          <ApprovalPanel
            key={snapshot.approval.id}
            approval={snapshot.approval}
            workspaceId={workspace.id}
            onError={onError}
          />
        )}
      </div>
    </main>
  );
}

export function Composer({
  snapshot,
  workspaceId,
  draft,
  onDraftChange,
  onSend,
  onError,
}: {
  snapshot: Snapshot;
  workspaceId: string;
  draft: string;
  onDraftChange: Dispatch<SetStateAction<string>>;
  onSend: (text: string) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const sending = useRef(false);
  const [pending, setPending] = useState(false);
  const busy = snapshot.status === "working";
  const connected = snapshot.status === "ready" || busy;
  const send = () => {
    if (!draft.trim() || !connected || sending.current) return;
    const submitted = draft;
    sending.current = true;
    setPending(true);
    onSend(submitted.trim())
      .then(() =>
        onDraftChange((current) => (current === submitted ? "" : current)),
      )
      .catch(onError)
      .finally(() => {
        sending.current = false;
        setPending(false);
      });
  };
  return (
    <div className="composer-area">
      <div className="composer">
        <textarea
          aria-label="Message Codex"
          placeholder={
            busy
              ? "Guide Codex while it works…"
              : "Ask Codex, or describe a view…"
          }
          value={draft}
          maxLength={24_000}
          rows={3}
          onChange={(event) => onDraftChange(event.target.value)}
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
            <kbd>↵</kbd> {busy ? "Steer" : "Send"}{" "}
            <span className="composer-hint">· Shift ↵ new line</span>
          </span>
          <div className="composer-actions">
            {busy && (
              <button
                type="button"
                className="stop-button"
                aria-label="Stop Codex"
                title="Stop this session"
                onClick={() =>
                  window.codexos.interrupt(workspaceId).catch(onError)
                }
              >
                <StopIcon size={12} weight="fill" />
              </button>
            )}
            <button
              type="button"
              className="send-button"
              aria-label={busy ? "Send guidance" : "Send message"}
              title={busy ? "Steer the current turn" : "Send message"}
              disabled={!draft.trim() || !connected || pending}
              onClick={send}
            >
              <ArrowUpIcon size={18} />
            </button>
          </div>
        </div>
      </div>
      <ModelControls snapshot={snapshot} onError={onError} />
    </div>
  );
}
