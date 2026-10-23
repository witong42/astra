import { useCallback, useEffect, useRef } from "react";
import type { CanvasAck, CanvasState } from "./canvas";

export type CanvasHandle = { flush: () => Promise<void> };
const CAPTURE_TIMEOUT_MS = 5000;
export function CanvasSurface({
  id,
  canvas,
  onError,
  handle,
}: {
  id: string;
  canvas: CanvasState;
  onError: (error: unknown) => void;
  handle: React.RefObject<CanvasHandle | null>;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const state = useRef(canvas);
  state.current = canvas;
  const sent = useRef(-1);
  const ready = useRef(false);
  const captures = useRef(
    new Map<
      string,
      {
        resolve: () => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  const lastSaved = useRef("");
  const saving = useRef(Promise.resolve());
  const post = useCallback((message: unknown) => {
    frame.current?.contentWindow?.postMessage(message, "*");
  }, []);
  useEffect(() => {
    const waiting = captures.current;
    const sendInitial = () => {
      const current = state.current;
      sent.current = current.revision;
      post({
        type: "canvas:init",
        html: current.html,
        css: current.css,
        revision: current.revision,
      });
      if (current.pending.length) {
        post({ type: "canvas:ops", entries: current.pending });
        sent.current = current.pending.at(-1)?.id ?? sent.current;
      }
    };
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = event.data;
      if (message?.type === "canvas:ready") {
        ready.current = true;
        sendInitial();
      } else if (message?.type === "canvas:snapshot") {
        const ack: CanvasAck = {
          revision: message.revision,
          html: message.html,
          css: message.css,
          ...(message.error ? { error: message.error } : {}),
        };
        const serialized = JSON.stringify(ack);
        const save =
          serialized === lastSaved.current
            ? saving.current
            : window.codexos.updateCanvas(id, ack);
        lastSaved.current = serialized;
        saving.current = save;
        const pending = waiting.get(message.requestId);
        save
          .then(() => {
            if (pending) {
              clearTimeout(pending.timer);
              waiting.delete(message.requestId);
              pending.resolve();
            }
          })
          .catch((error) => {
            lastSaved.current = "";
            onError(error);
            if (pending) {
              clearTimeout(pending.timer);
              waiting.delete(message.requestId);
              pending.reject(error);
            }
          });
      } else if (message?.type === "canvas:error") {
        onError(message.error);
        const pending = waiting.get(message.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          waiting.delete(message.requestId);
          pending.reject(new Error(message.error));
        }
      }
    };
    addEventListener("message", listener);
    handle.current = {
      flush: () =>
        new Promise((resolve, reject) => {
          if (!ready.current) {
            reject(
              new Error("The canvas is still opening. Try sending again."),
            );
            return;
          }
          const requestId = crypto.randomUUID();
          const timer = setTimeout(() => {
            waiting.delete(requestId);
            reject(
              new Error(
                "The canvas did not respond. Reopen this workspace to recover it.",
              ),
            );
          }, CAPTURE_TIMEOUT_MS);
          waiting.set(requestId, { resolve, reject, timer });
          post({ type: "canvas:capture", requestId });
        }),
    };
    return () => {
      removeEventListener("message", listener);
      handle.current = null;
      for (const entry of waiting.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("The workspace changed."));
      }
      waiting.clear();
    };
  }, [id, onError, handle, post]);
  useEffect(() => {
    if (!ready.current) return;
    if (canvas.revision > sent.current) {
      post({
        type: "canvas:init",
        html: canvas.html,
        css: canvas.css,
        revision: canvas.revision,
      });
      sent.current = canvas.revision;
    }
    const entries = canvas.pending.filter((entry) => entry.id > sent.current);
    if (entries.length) {
      post({ type: "canvas:ops", entries });
      sent.current = entries.at(-1)?.id ?? sent.current;
    }
  }, [canvas, post]);
  return (
    <iframe
      ref={frame}
      src="./canvas.html"
      sandbox="allow-scripts"
      title="Live generated canvas"
      className="canvas-frame"
    />
  );
}
