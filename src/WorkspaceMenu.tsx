import {
  DotsThreeIcon,
  PencilSimpleIcon,
  TrashIcon,
} from "@phosphor-icons/react";
import { useEffect, useId, useRef, useState } from "react";
import type { Workspace } from "./types";
import { appNameSchema, MAX_APP_NAME_LENGTH } from "./workspace-name";

const MENU_WIDTH = 264;
const SCREEN_MARGIN = 12;
const MENU_MAX_HEIGHT = 260;
const MENU_GAP = 8;
export function WorkspaceMenu({
  workspace,
  busy,
  onRename,
  onDelete,
}: {
  workspace: Workspace;
  busy: boolean;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(workspace.name);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useEffect(() => {
    if (editing) {
      input.current?.focus();
      input.current?.select();
    }
  }, [editing]);
  const close = () => {
    panel.current?.hidePopover();
    trigger.current?.focus();
  };
  const run = async (action: () => Promise<void>) => {
    setPending(true);
    setError("");
    try {
      await action();
      close();
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setPending(false);
    }
  };
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className="workspace-menu-trigger"
        aria-label={`Manage ${workspace.name}`}
        aria-haspopup="dialog"
        disabled={pending}
        popoverTarget={id}
        onClick={() => {
          const rect = trigger.current?.getBoundingClientRect();
          if (rect)
            setPosition({
              left: Math.max(
                SCREEN_MARGIN,
                Math.min(
                  rect.right - MENU_WIDTH,
                  innerWidth - MENU_WIDTH - SCREEN_MARGIN,
                ),
              ),
              top: Math.max(
                SCREEN_MARGIN,
                Math.min(rect.bottom + MENU_GAP, innerHeight - MENU_MAX_HEIGHT),
              ),
            });
          setName(workspace.name);
          setEditing(false);
          setError("");
        }}
      >
        <DotsThreeIcon size={22} weight="bold" />
      </button>
      <div
        id={id}
        ref={panel}
        popover="auto"
        role="dialog"
        aria-label={`Manage ${workspace.name}`}
        className="workspace-menu"
        style={position}
        onToggle={(event) => {
          if ((event.nativeEvent as ToggleEvent).newState === "open")
            queueMicrotask(() =>
              panel.current
                ?.querySelector<HTMLButtonElement>("button")
                ?.focus(),
            );
        }}
      >
        <div className="workspace-menu-heading">{workspace.name}</div>
        {editing ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const parsed = appNameSchema.safeParse(name);
              if (!parsed.success) {
                setError("Use one or two words, up to 32 characters.");
                return;
              }
              void run(() => onRename(workspace.id, parsed.data));
            }}
          >
            <label htmlFor={`${id}-name`}>App name</label>
            <input
              id={`${id}-name`}
              ref={input}
              className="workspace-name-input"
              value={name}
              maxLength={MAX_APP_NAME_LENGTH}
              disabled={pending}
              onChange={(event) => setName(event.currentTarget.value)}
            />
            <small>One or two words.</small>
            <div className="workspace-menu-actions">
              <button type="button" disabled={pending} onClick={close}>
                Cancel
              </button>
              <button type="submit" className="primary" disabled={pending}>
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </form>
        ) : (
          <>
            <button
              type="button"
              className="workspace-menu-item"
              disabled={pending}
              onClick={() => setEditing(true)}
            >
              <PencilSimpleIcon />
              Rename
            </button>
            <button
              type="button"
              className="workspace-menu-item destructive"
              disabled={busy || pending}
              onClick={() => void run(() => onDelete(workspace.id))}
            >
              <TrashIcon />
              {pending ? "Deleting…" : "Delete app"}
            </button>
            {busy && (
              <p className="workspace-menu-hint">
                Stop the current response to delete this app.
              </p>
            )}
          </>
        )}
        {error && (
          <p role="alert" className="workspace-menu-error">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
