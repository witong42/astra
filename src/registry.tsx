import {
  defineRegistry,
  useStateStore,
  useStateValue,
} from "@json-render/react";
import {
  type CSSProperties,
  createContext,
  useContext,
  useId,
  useState,
} from "react";
import { catalog } from "./catalog";

type Row = Record<string, unknown>;
const MAX_VISIBLE_ROWS = 200;
const MAX_CHART_BARS = 20;
const EMPTY_ROWS: Row[] = [];
const display = (value: unknown) =>
  value == null
    ? "—"
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
function useRows(path: string) {
  const value = useStateValue<unknown>(path);
  return Array.isArray(value)
    ? value.filter(
        (row): row is Row =>
          Boolean(row) && typeof row === "object" && !Array.isArray(row),
      )
    : EMPTY_ROWS;
}

function Table({
  title,
  statePath,
  columns,
}: {
  title?: string;
  statePath: string;
  columns: { key: string; label: string }[];
}) {
  const rows = useRows(statePath);
  const [sort, setSort] = useState<{ key: string; ascending: boolean } | null>(
    null,
  );
  const sorted = sort
    ? [...rows].sort(
        (a, b) =>
          display(a[sort.key]).localeCompare(display(b[sort.key]), undefined, {
            numeric: true,
          }) * (sort.ascending ? 1 : -1),
      )
    : rows;
  return (
    <section className="gen-table">
      {title && <h3>{title}</h3>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    sort?.key === column.key
                      ? sort.ascending
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    className="table-sort-button"
                    onClick={() =>
                      setSort({
                        key: column.key,
                        ascending:
                          sort?.key === column.key ? !sort.ascending : true,
                      })
                    }
                  >
                    {column.label}
                    <span className="table-sort-indicator" aria-hidden="true">
                      {sort?.key === column.key
                        ? sort.ascending
                          ? " ↑"
                          : " ↓"
                        : " ↕"}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, MAX_VISIBLE_ROWS).map((row, index) => (
              <tr key={String(row.id ?? index)}>
                {columns.map((column) => (
                  <td key={column.key}>{display(row[column.key])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <p className="muted small">No rows yet.</p>}
      {rows.length > MAX_VISIBLE_ROWS && (
        <p className="muted small">
          Showing {MAX_VISIBLE_ROWS} of {rows.length} rows.
        </p>
      )}
    </section>
  );
}

function Board({
  title,
  statePath,
  columns,
}: {
  title?: string;
  statePath: string;
  columns: string[];
}) {
  const rows = useRows(statePath);
  const store = useStateStore();
  const update = (index: number, values: Row) =>
    store.set(
      statePath,
      rows.map((row, current) =>
        current === index ? { ...row, ...values } : row,
      ),
    );
  return (
    <section className="gen-board">
      {title && <h3>{title}</h3>}
      <div
        className="board-columns"
        style={{
          gridTemplateColumns: `repeat(${columns.length}, minmax(190px, 1fr))`,
        }}
      >
        {columns.map((column) => (
          <section className="board-column" key={column} aria-label={column}>
            <div className="column-heading">
              <span>{column}</span>
              <span className="count">
                {
                  rows.filter((row) => (row.status ?? columns[0]) === column)
                    .length
                }
              </span>
            </div>
            {rows.map(
              (row, index) =>
                (row.status ?? columns[0]) === column && (
                  <article
                    className="task"
                    key={String(row.id ?? index)}
                    data-task-id={String(row.id ?? index)}
                  >
                    <input
                      className="task-title"
                      aria-label="Task title"
                      value={display(row.title)}
                      onChange={(event) =>
                        update(index, { title: event.target.value })
                      }
                    />
                    {row.detail != null && <p>{display(row.detail)}</p>}
                    <div className="task-footer">
                      <select
                        aria-label={`Status of ${display(row.title)}`}
                        value={String(row.status ?? columns[0])}
                        onChange={(event) =>
                          update(index, { status: event.target.value })
                        }
                      >
                        {columns.map((status) => (
                          <option key={status}>{status}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="delete-task"
                        aria-label={`Delete ${display(row.title)}`}
                        onClick={() =>
                          store.set(
                            statePath,
                            rows.filter((_row, current) => current !== index),
                          )
                        }
                      >
                        ×
                      </button>
                    </div>
                  </article>
                ),
            )}
            <button
              type="button"
              className="add-task"
              onClick={() =>
                store.set(statePath, [
                  ...rows,
                  {
                    id: crypto.randomUUID(),
                    title: "New task",
                    status: column,
                  },
                ])
              }
            >
              ＋ Add task
            </button>
          </section>
        ))}
      </div>
    </section>
  );
}

function Chart({ title, statePath }: { title?: string; statePath: string }) {
  const rows = useRows(statePath).slice(0, MAX_CHART_BARS);
  const maximum = Math.max(
    1,
    ...rows.map((row) => Math.abs(Number(row.value) || 0)),
  );
  return (
    <section className="gen-chart">
      {title && <h3>{title}</h3>}
      {rows.map((row, index) => (
        <div className="chart-row" key={String(row.id ?? index)}>
          <span>{display(row.label)}</span>
          <div className="chart-track">
            <div
              className="chart-bar"
              style={{
                width: `${Math.min(100, (Math.abs(Number(row.value) || 0) / maximum) * 100)}%`,
              }}
            />
          </div>
          <strong>{display(row.value)}</strong>
        </div>
      ))}
    </section>
  );
}

function Input({
  label,
  statePath,
  placeholder,
}: {
  label: string;
  statePath: string;
  placeholder?: string;
}) {
  const id = useId();
  const value = useStateValue<unknown>(statePath);
  const store = useStateStore();
  return (
    <div className="gen-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        value={value == null ? "" : String(value)}
        placeholder={placeholder}
        onChange={(event) => store.set(statePath, event.target.value)}
      />
    </div>
  );
}

function Checkbox({ label, statePath }: { label: string; statePath: string }) {
  const value = useStateValue<unknown>(statePath);
  const store = useStateStore();
  return (
    <label className="gen-checkbox">
      <input
        type="checkbox"
        checked={value === true}
        onChange={(event) => store.set(statePath, event.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}

function Select({
  label,
  statePath,
  options,
}: {
  label: string;
  statePath: string;
  options: string[];
}) {
  const id = useId();
  const value = useStateValue<unknown>(statePath);
  const store = useStateStore();
  return (
    <div className="gen-field">
      <label htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value == null ? "" : String(value)}
        onChange={(event) => store.set(statePath, event.target.value)}
      >
        <option value="" disabled>
          Select an option
        </option>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    </div>
  );
}

export const AgentActionContext = createContext<
  ((prompt: string) => void) | null
>(null);
function AgentButton({ label, prompt }: { label: string; prompt: string }) {
  const onAsk = useContext(AgentActionContext);
  return (
    <button
      type="button"
      className="gen-button"
      onClick={() => onAsk?.(prompt)}
    >
      {label}
      <span aria-hidden="true"> ↗</span>
    </button>
  );
}
export const { registry } = defineRegistry(catalog, {
  components: {
    Stack: ({ props, children }) => (
      <div
        className={`gen-stack gap-${props.gap ?? "medium"}`}
        data-direction={props.direction ?? "vertical"}
      >
        {children}
      </div>
    ),
    Grid: ({ props, children }) => (
      <div
        className="gen-grid"
        style={
          {
            "--grid-columns": props.columns ?? 2,
          } as CSSProperties
        }
      >
        {children}
      </div>
    ),
    Card: ({ props, children }) => (
      <section className="gen-card">
        {props.title && <h3>{props.title}</h3>}
        {props.description && <p className="muted">{props.description}</p>}
        {children}
      </section>
    ),
    Heading: ({ props }) => {
      const Tag = props.level ?? "h2";
      return <Tag>{props.text}</Tag>;
    },
    Text: ({ props }) => (
      <p className={`gen-text tone-${props.tone ?? "normal"}`}>{props.text}</p>
    ),
    Metric: ({ props }) => (
      <div className="gen-metric">
        <span>{props.label}</span>
        <strong>{props.value}</strong>
        {props.detail && <small>{props.detail}</small>}
      </div>
    ),
    Divider: () => <hr className="gen-divider" />,
    Table: ({ props }) => <Table {...props} />,
    Board: ({ props }) => <Board {...props} />,
    Chart: ({ props }) => <Chart {...props} />,
    Input: ({ props }) => <Input {...props} />,
    Checkbox: ({ props }) => <Checkbox {...props} />,
    Select: ({ props }) => <Select {...props} />,
    Button: ({ props }) => <AgentButton {...props} />,
  },
});
