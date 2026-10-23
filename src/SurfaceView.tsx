import { createStateStore, JSONUIProvider, Renderer } from "@json-render/react";
import {
  Component,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { type CanvasHandle, CanvasSurface } from "./CanvasSurface";
import { OpenUISurface } from "./OpenUISurface";
import { AgentActionContext, registry } from "./registry";
import type { Workspace } from "./types";

class RenderBoundary extends Component<
  { children: ReactNode; revision: number },
  { error: string | null }
> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  componentDidUpdate(previous: { revision: number }) {
    if (previous.revision !== this.props.revision && this.state.error)
      this.setState({ error: null });
  }
  render() {
    return this.state.error ? (
      <div className="surface-error" role="alert">
        This view could not render. Ask Codex to simplify or replace it.
        <details>
          <summary>Details</summary>
          {this.state.error}
        </details>
      </div>
    ) : (
      this.props.children
    );
  }
}

const escapePointer = (value: string) =>
  value.replace(/~/g, "~0").replace(/\//g, "~1");

function LegacySurface({
  workspace,
  patches,
  busy,
  onAsk,
  onError,
}: {
  workspace: Workspace;
  patches: number;
  busy: boolean;
  onAsk: (text: string) => void;
  onError: (error: unknown) => void;
}) {
  const [store] = useState(() => createStateStore(workspace.spec.state));
  const syncing = useRef(false);
  const stateRef = useRef(workspace.spec.state);
  stateRef.current = workspace.spec.state;

  useEffect(() => {
    let previous = store.getSnapshot();
    return store.subscribe(() => {
      const current = store.getSnapshot();
      const changed = Object.entries(current).filter(
        ([key, value]) => value !== previous[key],
      );
      previous = current;
      if (syncing.current) return;
      for (const [key, value] of changed)
        window.codexos
          .updateData(workspace.id, `/${escapePointer(key)}`, value)
          .catch(onError);
    });
  }, [store, workspace.id, onError]);

  useEffect(() => {
    if (patches === 0) return;
    syncing.current = true;
    const state = stateRef.current ?? {};
    store.update(
      Object.fromEntries(
        Object.entries(state).map(([key, value]) => [
          `/${escapePointer(key)}`,
          value,
        ]),
      ),
    );
    syncing.current = false;
  }, [store, patches]);

  return (
    <RenderBoundary revision={patches}>
      <AgentActionContext value={onAsk}>
        <JSONUIProvider registry={registry} store={store}>
          <Renderer spec={workspace.spec} registry={registry} loading={busy} />
        </JSONUIProvider>
      </AgentActionContext>
    </RenderBoundary>
  );
}

export function Surface(
  props: Omit<Parameters<typeof LegacySurface>[0], "onAsk" | "onError"> & {
    handle: React.RefObject<CanvasHandle | null>;
    onAsk: (text: string, workspaceId: string) => void;
    onError: (workspaceId: string, error: unknown) => void;
  },
) {
  const id = props.workspace.id;
  const onError = useCallback(
    (error: unknown) => props.onError(id, error),
    [id, props.onError],
  );
  const onAsk = useCallback(
    (text: string) => props.onAsk(text, id),
    [id, props.onAsk],
  );
  if (props.workspace.canvas?.openui)
    return (
      <RenderBoundary
        revision={props.patches + props.workspace.canvas.generation}
      >
        <OpenUISurface
          id={id}
          canvas={props.workspace.canvas}
          busy={props.busy}
          onAsk={onAsk}
          onError={onError}
          handle={props.handle}
        />
      </RenderBoundary>
    );
  return props.workspace.canvas ? (
    <CanvasSurface
      id={id}
      canvas={props.workspace.canvas}
      onError={onError}
      handle={props.handle}
    />
  ) : (
    <LegacySurface {...props} onAsk={onAsk} onError={onError} />
  );
}
