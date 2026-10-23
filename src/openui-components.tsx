import {
  createLibrary,
  defineComponent,
  useIsStreaming,
  useStateField,
  useTriggerAction,
} from "@openuidev/react-lang";
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  useContext,
  useId,
} from "react";
import { type CanvasInputs, uiComponents as ui } from "./openui";

export const OpenUICanvasContext = createContext<
  (inputs: CanvasInputs, height: number) => ReactNode
>(() => null);

export const openuiLibrary = createLibrary({
  root: "Stack",
  components: [
    defineComponent({
      ...ui.Stack,
      component: ({ props, renderNode }) => (
        <div className="gen-stack">{renderNode(props.children)}</div>
      ),
    }),
    defineComponent({
      ...ui.Grid,
      component: ({ props, renderNode }) => (
        <div
          className="gen-grid"
          style={{ "--grid-columns": props.columns ?? 2 } as CSSProperties}
        >
          {renderNode(props.children)}
        </div>
      ),
    }),
    defineComponent({
      ...ui.Card,
      component: ({ props, renderNode }) => (
        <section className="gen-card">
          <h3>{props.title}</h3>
          <div className="gen-stack">{renderNode(props.children)}</div>
        </section>
      ),
    }),
    defineComponent({
      ...ui.Heading,
      component: ({ props }) => (
        <h2 className="openui-heading">{props.text}</h2>
      ),
    }),
    defineComponent({
      ...ui.Text,
      component: ({ props }) => <p className="openui-text">{props.text}</p>,
    }),
    defineComponent({
      ...ui.Metric,
      component: ({ props }) => (
        <div className="gen-metric">
          <span className="metric-label">{props.label}</span>
          <strong>{props.value}</strong>
          {props.detail && <span className="muted small">{props.detail}</span>}
        </div>
      ),
    }),
    defineComponent({
      ...ui.Slider,
      component: function Slider({ props }) {
        const field = useStateField(props.name, props.value);
        const id = useId();
        const disabled = useIsStreaming();
        const value = typeof field.value === "number" ? field.value : props.min;
        return (
          <div className="openui-control">
            <div className="openui-control-label">
              <label htmlFor={id}>{props.label}</label>
              <output htmlFor={id}>{value}</output>
            </div>
            <input
              id={id}
              name={props.name}
              type="range"
              min={props.min}
              max={props.max}
              step={props.step}
              value={value}
              disabled={disabled}
              onChange={(event) =>
                field.setValue(event.currentTarget.valueAsNumber)
              }
            />
          </div>
        );
      },
    }),
    defineComponent({
      ...ui.Toggle,
      component: function Toggle({ props }) {
        const field = useStateField(props.name, props.value);
        const disabled = useIsStreaming();
        return (
          <label className="openui-toggle">
            <span>{props.label}</span>
            <input
              type="checkbox"
              name={props.name}
              checked={field.value === true}
              disabled={disabled}
              onChange={(event) => field.setValue(event.currentTarget.checked)}
            />
          </label>
        );
      },
    }),
    defineComponent({
      ...ui.Select,
      component: function Select({ props }) {
        const field = useStateField(props.name, props.value);
        const id = useId();
        const disabled = useIsStreaming();
        return (
          <div className="openui-control">
            <label htmlFor={id}>{props.label}</label>
            <select
              id={id}
              name={props.name}
              value={String(field.value ?? "")}
              disabled={disabled}
              onChange={(event) => field.setValue(event.currentTarget.value)}
            >
              {props.options.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </div>
        );
      },
    }),
    defineComponent({
      ...ui.Input,
      component: function Input({ props }) {
        const field = useStateField(props.name, props.value);
        const id = useId();
        const disabled = useIsStreaming();
        const attributes = {
          id,
          name: props.name,
          value: String(field.value ?? ""),
          disabled,
          onChange: (
            event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
          ) => field.setValue(event.currentTarget.value),
        };
        return (
          <div className="openui-control">
            <label htmlFor={id}>{props.label}</label>
            {props.multiline ? (
              <textarea {...attributes} rows={3} />
            ) : (
              <input {...attributes} type="text" />
            )}
          </div>
        );
      },
    }),
    defineComponent({
      ...ui.Button,
      component: function Button({ props }) {
        const trigger = useTriggerAction();
        const disabled = useIsStreaming();
        return (
          <button
            type="button"
            className="secondary-button openui-button"
            disabled={disabled}
            onClick={() => trigger(props.label, undefined, props.action)}
          >
            {props.label}
          </button>
        );
      },
    }),
    defineComponent({
      ...ui.Table,
      component: ({ props }) => (
        <div className="gen-table table-scroll">
          <table>
            <thead>
              <tr>
                {props.columns.map((column, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: Read-only headers may have repeated labels and contain no local state.
                  <th key={index} scope="col">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {props.rows.map((row, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: Read-only rows may repeat and contain no local state.
                <tr key={index}>
                  {row.map((value, cell) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: Read-only cells may repeat and contain no local state.
                    <td key={cell}>{value == null ? "—" : String(value)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {!props.rows.length && <p className="muted small">No rows yet.</p>}
        </div>
      ),
    }),
    defineComponent({
      ...ui.BarChart,
      component: ({ props }) => {
        const max = Math.max(1, ...props.data.map((item) => item.value));
        return (
          <figure className="openui-chart">
            <figcaption>{props.title}</figcaption>
            {props.data.map((item) => (
              <div className="openui-chart-row" key={item.label}>
                <span>{item.label}</span>
                <div className="openui-chart-track">
                  <div
                    className="openui-chart-bar"
                    style={{ width: `${(item.value / max) * 100}%` }}
                  />
                </div>
                <span>{item.value}</span>
              </div>
            ))}
          </figure>
        );
      },
    }),
    defineComponent({
      ...ui.LiveCanvas,
      component: function LiveCanvas({ props }) {
        const render = useContext(OpenUICanvasContext);
        return render(props.inputs, props.height ?? 360);
      },
    }),
  ],
});
