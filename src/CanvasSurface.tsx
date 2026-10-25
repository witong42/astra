import { useCallback, useEffect, useRef } from "react";
import { CANVAS_CONTROL_PREFIX, type SurfaceControl } from "./app-control";
import type { CanvasAck, CanvasState } from "./canvas";
import { useLocale } from "./LocaleProvider";
import type { CanvasInputs } from "./openui";
import type { Bridge } from "./types";

export type CanvasHandle = {
  flush: () => Promise<void>;
  isReady?: () => boolean;
  control?: (request: SurfaceControl) => Promise<unknown>;
};
const CAPTURE_TIMEOUT_MS = 5000;
export function CanvasSurface({
  id,
  canvas,
  onError,
  handle,
  inputs,
}: {
  id: string;
  canvas: CanvasState;
  onError: (error: unknown) => void;
  handle: React.RefObject<CanvasHandle | null>;
  inputs?: CanvasInputs;
}) {
  const { t } = useLocale();
  const frame = useRef<HTMLIFrameElement>(null);
  const state = useRef(canvas);
  state.current = canvas;
  const inputRef = useRef(inputs);
  inputRef.current = inputs;
  const sent = useRef(-1);
  const ready = useRef(false);
  const nativePort = useRef<MessagePort | null>(null);
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
  const controls = useRef(
    new Map<
      string,
      {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >(),
  );
  const saving = useRef(Promise.resolve());
  const post = useCallback((message: unknown) => {
    frame.current?.contentWindow?.postMessage(message, "*");
  }, []);
  const connect = useCallback(() => {
    ready.current = false;
    nativePort.current?.close();
    const channel = new MessageChannel();
    const port = channel.port1;
    nativePort.current = port;
    port.onmessage = (event) => {
      const message = event.data;
      if (message?.type === "canvas:native-ready" && !ready.current) {
        ready.current = true;
        const current = state.current;
        sent.current = current.revision;
        post({
          type: "canvas:init",
          html: current.html,
          css: current.css,
          revision: current.revision,
          inputs: inputRef.current,
        });
        if (current.pending.length) {
          post({ type: "canvas:ops", entries: current.pending });
          sent.current = current.pending.at(-1)?.id ?? sent.current;
        }
        return;
      }
      const runners: Record<string, Bridge["runAppleScript"]> = {
        "canvas:applescript": window.astra.runAppleScript,
        "canvas:powershell": window.astra.runPowerShell,
        "canvas:shell": window.astra.runShellScript,
      };
      const run =
        typeof message?.type === "string" &&
        Object.hasOwn(runners, message.type)
          ? runners[message.type]
          : undefined;
      if (
        !run ||
        typeof message.requestId !== "string" ||
        message.requestId.length > 100
      )
        return;
      const requestId = message.requestId;
      if (frame.current?.closest("[inert]")) {
        port.postMessage({
          requestId,
          error: "Open this mini-app before running its native actions.",
        });
        return;
      }
      run(id, message.request).then(
        (stdout) => port.postMessage({ requestId, stdout }),
        (error) =>
          port.postMessage({
            requestId,
            error: error instanceof Error ? error.message : String(error),
          }),
      );
    };
    frame.current?.contentWindow?.postMessage({ type: "canvas:connect" }, "*", [
      channel.port2,
    ]);
  }, [id, post]);
  useEffect(() => {
    const waiting = captures.current;
    const pendingControls = controls.current;
    const listener = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = event.data;
      if (message?.type === "canvas:control-result") {
        const pending = pendingControls.get(message.requestId);
        if (!pending) return;
        clearTimeout(pending.timer);
        pendingControls.delete(message.requestId);
        if (message.error) pending.reject(new Error(message.error));
        else pending.resolve(message.result);
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
            : window.astra.updateCanvas(id, ack);
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
      } else if (message?.type === "canvas:open-link") {
        window.astra.openExternal(message.url).catch(onError);
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
      isReady: () => ready.current,
      control: (request) =>
        new Promise((resolve, reject) => {
          if (!ready.current) {
            reject(new Error("The app is still opening. Retry the command."));
            return;
          }
          const requestId = crypto.randomUUID();
          const timer = setTimeout(() => {
            pendingControls.delete(requestId);
            reject(new Error("The app did not confirm the control action."));
          }, CAPTURE_TIMEOUT_MS);
          pendingControls.set(requestId, { resolve, reject, timer });
          const action =
            request.action !== "inspect" &&
            request.selector.startsWith(CANVAS_CONTROL_PREFIX)
              ? {
                  ...request,
                  selector: request.selector.slice(
                    CANVAS_CONTROL_PREFIX.length,
                  ),
                }
              : request;
          post({ type: "canvas:control", request: action, requestId });
        }),
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
      nativePort.current?.close();
      handle.current = null;
      for (const entry of waiting.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("The workspace changed."));
      }
      waiting.clear();
      for (const pending of pendingControls.values()) {
        clearTimeout(pending.timer);
        pending.reject(
          new Error("The app changed before confirming the control action."),
        );
      }
      pendingControls.clear();
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
        inputs: inputRef.current,
      });
      sent.current = canvas.revision;
    }
    const entries = canvas.pending.filter((entry) => entry.id > sent.current);
    if (entries.length) {
      post({ type: "canvas:ops", entries });
      sent.current = entries.at(-1)?.id ?? sent.current;
    }
  }, [canvas, post]);
  useEffect(() => {
    if (ready.current && inputs) post({ type: "canvas:inputs", inputs });
  }, [inputs, post]);
  return (
    <iframe
      ref={frame}
      onLoad={connect}
      name={id}
      src="./canvas.html"
      sandbox="allow-scripts"
      title={t.generatedCanvas}
      className="canvas-frame"
    />
  );
}
