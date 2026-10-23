import { type OpenUIError, Renderer } from "@openuidev/react-lang";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type CanvasHandle, CanvasSurface } from "./CanvasSurface";
import type { CanvasState } from "./canvas";
import { type CanvasInputs, inspectOpenUI } from "./openui";
import { OpenUICanvasContext, openuiLibrary } from "./openui-components";

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
  const ui = canvas.openui;
  if (!ui) throw new Error("This workspace has no OpenUI layout.");
  const innerHandle = useRef<CanvasHandle | null>(null);
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
      const save = window.codexos.updateOpenUI(id, generation.current, state);
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
      flush: async () => {
        await pending.current;
        await innerHandle.current?.flush();
      },
    };
    return () => {
      handle.current = null;
    };
  }, [handle]);
  const renderCanvas = useCallback(
    (inputs: CanvasInputs, height: number) => (
      <section
        className="openui-live-canvas"
        style={{ height }}
        aria-label="Interactive canvas"
      >
        <CanvasSurface
          id={id}
          canvas={canvas}
          onError={onError}
          handle={innerHandle}
          inputs={inputs}
        />
      </section>
    ),
    [id, canvas, onError],
  );
  return (
    <div className="openui-surface">
      {errors.length > 0 && (
        <div className="surface-error" role="alert">
          This layout needs a correction. Ask Codex to repair it.
          <details>
            <summary>Details</summary>
            {errors.join(" ")}
          </details>
        </div>
      )}
      <OpenUICanvasContext value={renderCanvas}>
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
              window.codexos
                .openExternal(String(event.params.url))
                .catch(onError);
            else if (event.type === "continue_conversation")
              onAsk(
                `${event.humanFriendlyMessage}${event.formState ? `\nControl values: ${JSON.stringify(event.formState)}` : ""}`,
              );
          }}
        />
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
