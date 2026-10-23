import {
  CaretDownIcon,
  CheckIcon,
  LightningIcon,
  SlidersHorizontalIcon,
} from "@phosphor-icons/react";
import { useId, useRef, useState } from "react";
import type { Snapshot } from "./types";

type Choice = { value: string; label: string; description?: string };
function ChoiceMenu({
  label,
  value,
  choices,
  disabled,
  icon,
  onSelect,
  onError,
}: {
  label: string;
  value: string;
  choices: Choice[];
  disabled: boolean;
  icon?: "reasoning" | "speed";
  onSelect: (value: string) => Promise<void>;
  onError: (error: unknown) => void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, bottom: 0 });
  const selected = choices.find((choice) => choice.value === value);
  return (
    <>
      <button
        type="button"
        ref={trigger}
        className={`choice-trigger ${icon ? "" : "model-choice"}`}
        data-setting={label}
        popoverTarget={id}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${selected?.label ?? "Default"}`}
        disabled={disabled}
        title={label}
        onClick={() => {
          const rect = trigger.current?.getBoundingClientRect();
          if (rect)
            setPosition({
              left: Math.max(12, Math.min(rect.left, innerWidth - 332)),
              bottom: innerHeight - rect.top + 8,
            });
        }}
      >
        {icon === "reasoning" && <SlidersHorizontalIcon size={14} />}
        {icon === "speed" && <LightningIcon size={14} />}
        <span>{selected?.label ?? "Default"}</span>
        <CaretDownIcon className="choice-chevron" size={10} />
      </button>
      <div
        ref={menu}
        id={id}
        popover="auto"
        role="listbox"
        aria-label={label}
        className="choice-menu"
        style={position}
        onToggle={(event) => {
          const visible =
            (event.nativeEvent as ToggleEvent).newState === "open";
          setOpen(visible);
          if (visible)
            queueMicrotask(() =>
              menu.current
                ?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
                ?.focus(),
            );
        }}
        onKeyDown={(event) => {
          const options = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role="option"]',
            ),
          ];
          const current = options.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          let next: number;
          switch (event.key) {
            case "ArrowDown":
              next = (current + 1) % options.length;
              break;
            case "ArrowUp":
              next = (current - 1 + options.length) % options.length;
              break;
            case "Home":
              next = 0;
              break;
            case "End":
              next = options.length - 1;
              break;
            default:
              return;
          }
          event.preventDefault();
          options[next]?.focus();
        }}
      >
        <div className="choice-menu-heading">{label}</div>
        {choices.map((choice) => (
          <button
            type="button"
            role="option"
            aria-selected={choice.value === value}
            tabIndex={choice.value === value ? 0 : -1}
            key={choice.value}
            data-value={choice.value}
            className="choice-option"
            onClick={() => {
              menu.current?.hidePopover();
              trigger.current?.focus();
              if (choice.value !== value) onSelect(choice.value).catch(onError);
            }}
          >
            <span className="choice-copy">
              <strong>{choice.label}</strong>
              {choice.description && <small>{choice.description}</small>}
            </span>
            <span className="choice-check" aria-hidden="true">
              {choice.value === value && <CheckIcon size={14} />}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

export function ModelControls({
  snapshot,
  onError,
}: {
  snapshot: Snapshot;
  onError: (error: unknown) => void;
}) {
  const busy = snapshot.status === "working";
  const selection = busy
    ? (snapshot.sessions[snapshot.activeId]?.settings ?? snapshot)
    : snapshot;
  const model = snapshot.models.find(
    (entry) => entry.model === selection.model,
  );
  return (
    <div className="model-controls">
      <ChoiceMenu
        label="Model"
        value={selection.model}
        choices={snapshot.models.map((entry) => ({
          value: entry.model,
          label: entry.displayName || entry.model,
        }))}
        disabled={busy}
        onSelect={window.codexos.setModel}
        onError={onError}
      />
      <ChoiceMenu
        label="Reasoning effort"
        value={selection.reasoningEffort}
        icon="reasoning"
        choices={
          model?.supportedReasoningEfforts?.map((entry) => ({
            value: entry.reasoningEffort,
            label:
              entry.reasoningEffort === "xhigh"
                ? "Extra high"
                : entry.reasoningEffort.charAt(0).toUpperCase() +
                  entry.reasoningEffort.slice(1),
            description: entry.description,
          })) ?? []
        }
        disabled={busy || !model?.supportedReasoningEfforts?.length}
        onSelect={window.codexos.setReasoningEffort}
        onError={onError}
      />
      <ChoiceMenu
        label="Model speed"
        value={selection.serviceTier}
        icon="speed"
        choices={[
          {
            value: "default",
            label: "Standard",
            description: "Normal speed and usage",
          },
          ...(model?.serviceTiers?.map((tier) => ({
            value: tier.id,
            label: tier.name,
            description: tier.description,
          })) ?? []),
        ]}
        disabled={busy || !model?.serviceTiers?.length}
        onSelect={window.codexos.setServiceTier}
        onError={onError}
      />
    </div>
  );
}
