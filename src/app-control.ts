export type SurfaceControl =
  | { action: "inspect" }
  | { action: "click"; selector: string }
  | { action: "fill"; selector: string; value: string | boolean };
export type AppControl =
  | { action: "status" }
  | { action: "home" }
  | { action: "open"; id: string }
  | (SurfaceControl & { id: string });
export type AppController = (request: AppControl) => Promise<unknown>;
export const CANVAS_CONTROL_PREFIX = "canvas:";

const CONTROL_SELECTOR = "button,input,textarea,select,a[href],[role=button]";
const MAX_CONTROLS = 80;
const MAX_TEXT = 8_000;
const MAX_LABEL = 160;

function selectorFor(root: HTMLElement, element: HTMLElement): string {
  if (element.id) {
    const selector = `#${CSS.escape(element.id)}`;
    if (root.querySelectorAll(selector).length === 1) return selector;
  }
  const name = element.getAttribute("name");
  if (name) {
    const selector = `[name="${CSS.escape(name)}"]`;
    if (root.querySelectorAll(selector).length === 1) return selector;
  }
  const path: string[] = [];
  for (
    let node: HTMLElement | null = element;
    node && node !== root;
    node = node.parentElement
  ) {
    const index =
      Array.from(node.parentElement?.children ?? []).indexOf(node) + 1;
    path.unshift(`${node.localName}:nth-child(${index})`);
  }
  return `:scope > ${path.join(" > ")}`;
}

export function controlSurface(root: HTMLElement, request: SurfaceControl) {
  const visible = (node: HTMLElement) =>
    !node.closest("[hidden],[inert]") && node.getClientRects().length > 0;
  const controls = Array.from(
    root.querySelectorAll<HTMLElement>(CONTROL_SELECTOR),
  ).filter(visible);
  if (request.action === "inspect") {
    // biome-ignore lint/performance/useDomNodeTextContent: Inspection needs rendered text without hidden scripts or markup.
    const text = root.innerText;
    return {
      text: text.slice(0, MAX_TEXT),
      controls: controls.slice(0, MAX_CONTROLS).map((node) => ({
        selector: `${root.id === "substrate" ? CANVAS_CONTROL_PREFIX : ""}${selectorFor(root, node)}`,
        role: node.getAttribute("role") ?? node.localName,
        label: (
          node.getAttribute("aria-label") ??
          (node instanceof HTMLInputElement ||
          node instanceof HTMLSelectElement ||
          node instanceof HTMLTextAreaElement
            ? Array.from(node.labels ?? [])
                .map((label) => label.textContent)
                .join(" ") ||
              node.getAttribute("placeholder") ||
              node.name
            : (node.textContent ?? ""))
        ).slice(0, MAX_LABEL),
        ...(node instanceof HTMLInputElement && node.type === "password"
          ? {}
          : node instanceof HTMLInputElement ||
              node instanceof HTMLTextAreaElement ||
              node instanceof HTMLSelectElement
            ? { value: node.value }
            : {}),
        ...(node instanceof HTMLInputElement &&
        ["checkbox", "radio"].includes(node.type)
          ? { checked: node.checked }
          : {}),
        disabled: node.matches(":disabled,[aria-disabled=true]"),
        native: node.matches(
          "[data-applescript],[data-powershell],[data-shell],[data-astra-native]",
        ),
      })),
      truncated: controls.length > MAX_CONTROLS || text.length > MAX_TEXT,
    };
  }
  let matches: HTMLElement[];
  try {
    matches = Array.from(
      root.querySelectorAll<HTMLElement>(request.selector),
    ).filter(visible);
  } catch {
    throw new Error("Invalid control selector. Inspect the app first.");
  }
  if (matches.length !== 1)
    throw new Error(
      `Expected one visible control, found ${matches.length}. Inspect the app again.`,
    );
  const node = matches[0];
  if (!node.matches(CONTROL_SELECTOR))
    throw new Error("Select an interactive app control.");
  if (node.matches(":disabled,[aria-disabled=true]"))
    throw new Error("This control is disabled.");
  if (
    node.matches(
      "[data-applescript],[data-powershell],[data-shell],[data-astra-native]",
    )
  )
    throw new Error(
      "This native action requires a direct user gesture. Use the agent's desktop automation tools for a spoken request.",
    );
  if (request.action === "click") node.click();
  else {
    if (
      !(
        node instanceof HTMLInputElement ||
        node instanceof HTMLTextAreaElement ||
        node instanceof HTMLSelectElement
      )
    )
      throw new Error("This control is not an input, textarea, or select.");
    if (
      (node instanceof HTMLInputElement ||
        node instanceof HTMLTextAreaElement) &&
      node.readOnly
    )
      throw new Error("This field is read-only.");
    if (
      node instanceof HTMLSelectElement &&
      !Array.from(node.options).some(
        (option) => option.value === String(request.value),
      )
    )
      throw new Error(
        "This select has no matching option. Inspect the app again.",
      );
    if (
      node instanceof HTMLInputElement &&
      ["file", "password", "hidden", "button", "submit"].includes(node.type)
    )
      throw new Error("This input type cannot be filled through Astra.");
    if (
      node instanceof HTMLInputElement &&
      ["checkbox", "radio"].includes(node.type)
    ) {
      const checked = request.value === true || request.value === "true";
      if (
        request.value !== true &&
        request.value !== false &&
        request.value !== "true" &&
        request.value !== "false"
      )
        throw new Error("Use true or false for a checkbox or radio button.");
      if (node.checked !== checked) node.click();
    } else {
      const prototype =
        node instanceof HTMLInputElement
          ? HTMLInputElement.prototype
          : node instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLSelectElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(
        node,
        String(request.value),
      );
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  return { action: request.action, selector: request.selector, applied: true };
}
