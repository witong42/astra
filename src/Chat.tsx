import { ArrowUpIcon, StopIcon } from "@phosphor-icons/react";
import {
  type Dispatch,
  memo,
  type SetStateAction,
  useMemo,
  useRef,
  useState,
} from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useLocale } from "./LocaleProvider";
import { ModelControls } from "./ModelControls";
import { externalWebUrl } from "./navigation";
import type { Approval, Snapshot } from "./types";

const MARKDOWN_PLUGINS = [remarkGfm];
function markdownUrl(url: string, key: string) {
  if (key === "href" && url.startsWith("#")) return url;
  try {
    return externalWebUrl(url);
  } catch {
    return "";
  }
}
export const MarkdownMessage = memo(function MarkdownMessage({
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
                } else window.astra.openExternal(href).catch(onError);
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
              window.astra.openExternal(src).catch(onError);
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
  const { t } = useLocale();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  return (
    <section className="approval" aria-label={t.approvalRequest}>
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
              aria-label={t.answerLabel(question.header)}
              placeholder={t.yourAnswer}
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
              window.astra
                .answer(false, undefined, workspaceId, approval.id)
                .catch(onError)
            }
          >
            {t.decline}
          </button>
        )}
        <button
          type="button"
          className="primary"
          onClick={() =>
            window.astra
              .answer(true, answers, workspaceId, approval.id)
              .catch(onError)
          }
        >
          {approval.kind === "question" ? t.sendAnswer : t.allowOnce}
        </button>
      </div>
    </section>
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
  const { t } = useLocale();
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
          aria-label={t.messageAstra}
          placeholder={busy ? t.guideAstra : t.writeAstra}
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
            <kbd>↵</kbd> {busy ? t.steer : t.send}{" "}
            <span className="composer-hint">· {t.newLine}</span>
          </span>
          <div className="composer-actions">
            {busy && (
              <button
                type="button"
                className="stop-button"
                aria-label={t.stopAstra}
                title={t.stopSession}
                onClick={() =>
                  window.astra.interrupt(workspaceId).catch(onError)
                }
              >
                <StopIcon size={12} weight="fill" />
              </button>
            )}
            <button
              type="button"
              className="send-button"
              aria-label={busy ? t.sendGuidance : t.sendMessage}
              title={busy ? t.steerTurn : t.sendMessage}
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
