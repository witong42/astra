import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import { CANVAS_INSTRUCTIONS } from "../src/canvas-prompt";

type RuntimeEvent = {
  type?: string;
  isTrusted: boolean;
  source?: unknown;
  data?: unknown;
  ports?: unknown[];
  target?: unknown;
  defaultPrevented?: boolean;
  preventDefault?: () => void;
};
type NativeRequest = { type: string; requestId?: string; request?: unknown };
type NativeResponse = {
  data: { requestId?: string; stdout: string; error: string | null };
};

async function runtime() {
  const built = await Bun.build({
    entrypoints: [
      fileURLToPath(new URL("../src/canvas-runtime.ts", import.meta.url)),
    ],
    target: "browser",
  });
  if (!built.success) throw new AggregateError(built.logs);
  const listeners = new Map<string, ((event: RuntimeEvent) => void)[]>();
  const inputs: CustomEvent[] = [];
  const results: CustomEvent[] = [];
  const requests: NativeRequest[] = [];
  class Element {
    dataset: Record<string, string> = {};
    attributes = new Map<string, string>();
    textContent = "";
    outerHTML = '<main id="substrate"></main>';
    contains() {
      return true;
    }
    matches() {
      return false;
    }
    querySelectorAll() {
      return [];
    }
    cloneNode() {
      return new Element();
    }
    replaceWith() {}
    closest(selector: string) {
      return selector.includes("[data-applescript]") ||
        selector.includes("[data-powershell]") ||
        selector.includes("[data-shell]")
        ? this
        : null;
    }
    getAttribute(name: string) {
      return this.attributes.get(name) ?? null;
    }
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value);
    }
    removeAttribute(name: string) {
      this.attributes.delete(name);
    }
    dispatchEvent(event: CustomEvent) {
      results.push(event);
      return true;
    }
  }
  class Button extends Element {}
  const root = new Element();
  const script = new Element();
  script.setAttribute("type", "text/applescript");
  script.textContent = "return 1";
  const button = new Button();
  button.dataset.applescript = "native-script";
  const parent = { postMessage() {} };
  const window = { canvasInputs: null as unknown };
  const port = {
    postMessage: (value: NativeRequest) => requests.push(value),
    onmessage: null as null | ((event: NativeResponse) => void),
  };
  const document = {
    body: root,
    createElement: () => ({
      innerHTML: "",
      content: { querySelector: () => root, children: [root] },
    }),
    getElementById: (id: string) =>
      id === "substrate"
        ? root
        : id === "native-script"
          ? script
          : new Element(),
    addEventListener: (name: string, callback: (event: RuntimeEvent) => void) =>
      add(name, callback),
  };
  function add(name: string, callback: (event: RuntimeEvent) => void) {
    listeners.set(name, [...(listeners.get(name) ?? []), callback]);
  }
  function message(data: unknown, ports: unknown[] = []) {
    for (const listener of listeners.get("message") ?? [])
      listener({ source: parent, isTrusted: true, data, ports });
  }
  runInNewContext(await built.outputs[0].text(), {
    document,
    window,
    parent,
    Element,
    HTMLElement: Element,
    HTMLButtonElement: Button,
    HTMLInputElement: class {},
    HTMLSelectElement: class {},
    HTMLTextAreaElement: class {},
    CustomEvent,
    crypto,
    TextEncoder,
    URL,
    setTimeout,
    clearTimeout,
    MutationObserver: class {
      observe() {}
    },
    addEventListener: add,
    dispatchEvent: (event: CustomEvent) => inputs.push(event),
  });
  message({ type: "canvas:connect" }, [port]);
  message({
    type: "canvas:init",
    revision: 0,
    html: root.outerHTML,
    css: "",
    inputs: {},
  });
  inputs.length = 0;
  return {
    button,
    script,
    port,
    requests,
    inputs,
    results,
    window,
    message,
    click: (trusted = true) => {
      const event = {
        type: "click",
        isTrusted: trusted,
        defaultPrevented: false,
        target: button,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      for (const listener of listeners.get("click") ?? []) listener(event);
    },
  };
}

test("saved mini-apps and new Astra apps both receive their live input events", async () => {
  const view = await runtime();
  view.message({ type: "canvas:inputs", inputs: { speed: 2 } });
  expect(view.window.canvasInputs).toEqual({ speed: 2 });
  expect(view.inputs.map((event) => event.type)).toEqual([
    "astra:inputs",
    "codexos:inputs",
  ]);
  expect(view.inputs.map((event) => event.detail)).toEqual([
    { speed: 2 },
    { speed: 2 },
  ]);
});

test("one trusted native action notifies both namespaces without duplicate execution", async () => {
  const view = await runtime();
  view.click(false);
  expect(
    view.requests.filter((request) => request.type === "canvas:applescript"),
  ).toHaveLength(0);
  view.click();
  const actions = view.requests.filter(
    (request) => request.type === "canvas:applescript",
  );
  expect(actions).toHaveLength(1);
  view.port.onmessage?.({
    data: { requestId: actions[0].requestId, stdout: "1", error: null },
  });
  expect(view.results.map((event) => event.type)).toEqual([
    "astra:applescript",
    "codexos:applescript",
  ]);
  expect(view.results.map((event) => event.detail)).toEqual([
    { stdout: "1", error: null },
    { stdout: "1", error: null },
  ]);
});

test("native failures still notify saved mini-app listeners", async () => {
  const view = await runtime();
  view.script.setAttribute("type", "text/plain");
  view.click();
  expect(
    view.requests.filter((request) => request.type === "canvas:applescript"),
  ).toHaveLength(0);
  expect(view.results.map((event) => event.type)).toEqual([
    "astra:applescript",
    "codexos:applescript",
  ]);
  expect(view.results[0].detail.error).toContain("text/applescript");
});

test("PowerShell canvas actions retain trusted gestures and their own result event", async () => {
  const f = await runtime();
  delete f.button.dataset.applescript;
  f.button.dataset.powershell = "native-script";
  f.script.setAttribute("type", "text/powershell");
  f.script.textContent = "6 * 7";
  f.click(false);
  expect(
    f.requests.filter((value) => value.type === "canvas:powershell"),
  ).toHaveLength(0);
  f.click();
  const request = f.requests.find(
    (value) => value.type === "canvas:powershell",
  );
  expect(request?.request).toEqual({ script: "6 * 7", args: [] });
  f.port.onmessage?.({
    data: { requestId: request?.requestId, stdout: "42", error: null },
  });
  expect(f.results.at(-1)?.type).toBe("astra:powershell");
});

test("Linux shell canvas actions require trusted gestures and preserve argument data", async () => {
  const f = await runtime();
  delete f.button.dataset.applescript;
  f.button.dataset.shell = "native-script";
  f.button.dataset.shellArgs = JSON.stringify(["citron vert", "$(unsafe)"]);
  const scriptType = CANVAS_INSTRUCTIONS.match(
    /data-shell="my-script" with <script id="my-script" type="([^"]+)"/,
  )?.[1];
  f.script.setAttribute("type", scriptType ?? "");
  f.script.textContent = 'printf "%s" "$1"';
  f.click(false);
  expect(
    f.requests.filter((value) => value.type === "canvas:shell"),
  ).toHaveLength(0);
  f.click();
  const request = f.requests.find((value) => value.type === "canvas:shell");
  expect(request?.request).toEqual({
    script: 'printf "%s" "$1"',
    args: ["citron vert", "$(unsafe)"],
  });
  f.port.onmessage?.({
    data: { requestId: request?.requestId, stdout: "citron vert", error: null },
  });
  expect(f.results.at(-1)?.type).toBe("astra:shell");
});
