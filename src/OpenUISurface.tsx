import { type OpenUIError, Renderer } from "@openuidev/react-lang";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CANVAS_CONTROL_PREFIX,
  controlSurface,
  type SurfaceControl,
} from "./app-control";
import { type CanvasHandle, CanvasSurface } from "./CanvasSurface";
import type { CanvasState } from "./canvas";
import { LocaleContext, useLocale } from "./LocaleProvider";
import { type CanvasInputs, inspectOpenUI } from "./openui";
import {
  AppleScriptContext,
  OpenUICanvasContext,
  openuiLibrary,
} from "./openui-components";

export function OpenUISurface({
  id,
  canvas,
  busy,
  onAsk,
  onError,
  handle,
}: {
  id: string;
  canvas: CanvasState;
  busy: boolean;
  onAsk: (text: string) => void;
  onError: (error: unknown) => void;
  handle: React.RefObject<CanvasHandle | null>;
}) {
  const { t } = useLocale();
  const ui = canvas.openui;
  if (!ui) throw new Error("This workspace has no OpenUI layout.");
  const innerHandle = useRef<CanvasHandle | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const pending = useRef(Promise.resolve());
  const generation = useRef(canvas.generation);
  generation.current = canvas.generation;
  const lastSaved = useRef(JSON.stringify(ui.state));
  useEffect(() => {
    lastSaved.current = JSON.stringify(ui.state);
  }, [ui.state]);
  const [errors, setErrors] = useState<string[]>([]);
  const reportErrors = useCallback((issues: OpenUIError[]) => {
    const next = issues
      .filter((issue) => issue.severity !== "warning")
      .map((issue) => issue.message);
    setErrors((previous) =>
      JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
    );
  }, []);
  const hasCanvas = useMemo(
    () => inspectOpenUI(ui.source).liveCanvases > 0,
    [ui.source],
  );
  const persist = useCallback(
    (state: Record<string, unknown>) => {
      const serialized = JSON.stringify(state);
      if (serialized === lastSaved.current) return;
      lastSaved.current = serialized;
      const save = window.astra.updateOpenUI(id, generation.current, state);
      pending.current = save;
      save.catch((error) => {
        lastSaved.current = "";
        onError(error);
      });
    },
    [id, onError],
  );
  useEffect(() => {
    handle.current = {
      isReady: () => !hasCanvas || innerHandle.current?.isReady?.() === true,
      control: async (request: SurfaceControl) => {
        if (!root.current) throw new Error("The app is still opening.");
        if (request.action === "inspect") {
          const ui = controlSurface(root.current, request);
          const canvas = hasCanvas
            ? await innerHandle.current?.control?.(request)
            : undefined;
          return { ...ui, ...(canvas ? { canvas } : {}) };
        }
        if (request.selector.startsWith(CANVAS_CONTROL_PREFIX)) {
          if (!innerHandle.current?.control)
            throw new Error("This app has no live canvas.");
          return innerHandle.current.control({
            ...request,
            selector: request.selector.slice(CANVAS_CONTROL_PREFIX.length),
          });
        }
        return controlSurface(root.current, request);
      },
      flush: async () => {
        await pending.current;
        await innerHandle.current?.flush();
      },
    };
    return () => {
      handle.current = null;
    };
  }, [handle, hasCanvas]);
  const renderCanvas = useCallback(
    (inputs: CanvasInputs, height: number) => (
      <LocaleContext.Consumer>
        {({ t }) => (
          <section
            className="openui-live-canvas"
            style={{ height }}
            aria-label={t.interactiveCanvas}
          >
            <CanvasSurface
              id={id}
              canvas={canvas}
              onError={onError}
              handle={innerHandle}
              inputs={inputs}
            />
          </section>
        )}
      </LocaleContext.Consumer>
    ),
    [id, canvas, onError],
  );
  return (
    <div className="openui-surface" ref={root}>
      {errors.length > 0 && (
        <div className="surface-error" role="alert">
          {t.layoutFailed}
          <details>
            <summary>{t.details}</summary>
            {errors.join(" ")}
          </details>
        </div>
      )}
      <OpenUICanvasContext value={renderCanvas}>
        <AppleScriptContext
          value={(script, args, language) => {
            const run = {
              applescript: window.astra.runAppleScript,
              powershell: window.astra.runPowerShell,
              shell: window.astra.runShellScript,
            }[language ?? "applescript"];
            return run(id, { script, args });
          }}
        >
          <Renderer
            response={ui.source}
            library={openuiLibrary}
            initialState={ui.state}
            isStreaming={busy}
            publishObservability={false}
            onStateUpdate={persist}
            onError={reportErrors}
            onAction={(event) => {
              if (event.type === "open_url")
                window.astra
                  .openExternal(String(event.params.url))
                  .catch(onError);
              else if (event.type === "continue_conversation")
                onAsk(
                  `${event.humanFriendlyMessage}${event.formState ? `\nControl values: ${JSON.stringify(event.formState)}` : ""}`,
                );
            }}
          />
        </AppleScriptContext>
      </OpenUICanvasContext>
      {!hasCanvas && (
        <div className="openui-standby" aria-hidden="true">
          <CanvasSurface
            id={id}
            canvas={canvas}
            onError={onError}
            handle={innerHandle}
          />
        </div>
      )}
    </div>
  );
}
