// DOM mutation and script activation adapted from Substrate's public/shell.js.

import { controlSurface } from "./app-control";
import { externalWebUrl } from "./navigation";
import {
  CANVAS_SIZE_ERROR,
  MAX_CANVAS_BYTES,
  type MutationOp,
} from "./substrate-protocol";

(() => {
  const SAVE_INTERVAL_MS = 300;
  const sheet = document.getElementById("mutations") as HTMLStyleElement;
  let revision = 0;
  let initialized = false;
  let lastValidDocument = { html: '<main id="substrate"></main>', css: "" };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const root = () => document.getElementById("substrate");
  const post = (value: unknown) => parent.postMessage(value, "*");
  const errorText = (error: unknown) =>
    error instanceof Error ? error.message : String(error);
  const inputTarget = window as unknown as { canvasInputs: unknown };
  const nativeRequests = new Map<string, HTMLElement>();
  let nativePort: MessagePort | null = null;
  let sendNative: ((message: unknown) => void) | null = null;
  function updateInputs(inputs: unknown) {
    inputTarget.canvasInputs = inputs ?? {};
    dispatchEvent(
      new CustomEvent("codexos:inputs", { detail: inputTarget.canvasInputs }),
    );
  }

  function serializeDocument() {
    const host = root();
    if (!host) throw new Error("The canvas root #substrate is missing.");
    const clone = host.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("[data-applescript][aria-busy]").forEach((node) => {
      node.removeAttribute("aria-busy");
    });
    const fields = host.querySelectorAll("input,textarea,select");
    const clones = clone.querySelectorAll("input,textarea,select");
    fields.forEach((field, index) => {
      const copy = clones[index];
      if (field instanceof HTMLInputElement) {
        copy.setAttribute("value", field.value);
        copy.toggleAttribute("checked", field.checked);
      } else if (field instanceof HTMLTextAreaElement)
        copy.textContent = field.value;
      else if (field instanceof HTMLSelectElement) {
        [...copy.querySelectorAll("option")].forEach((option, i) => {
          option.toggleAttribute("selected", field.options[i].selected);
        });
      }
    });
    const html = clone.outerHTML;
    const css = sheet.textContent ?? "";
    if (new TextEncoder().encode(html + css).byteLength > MAX_CANVAS_BYTES)
      throw new Error(CANVAS_SIZE_ERROR);
    lastValidDocument = { html, css };
    return { html, css };
  }
  function snapshot(requestId?: string, error?: string) {
    post({
      type: "canvas:snapshot",
      revision,
      ...serializeDocument(),
      requestId,
      error,
    });
  }
  function scheduleSave() {
    if (!initialized || timer) return;
    timer = setTimeout(() => {
      timer = null;
      try {
        snapshot();
      } catch (error) {
        post({ type: "canvas:error", error: errorText(error) });
      }
    }, SAVE_INTERVAL_MS);
  }
  function activateScripts(node: Element) {
    for (const inert of node.matches("script")
      ? [node]
      : [...node.querySelectorAll("script")]) {
      const live = document.createElement("script");
      for (const attr of inert.attributes)
        live.setAttribute(attr.name, attr.value);
      live.textContent = inert.textContent;
      inert.replaceWith(live);
    }
  }
  function hydrate(html: string, css: string) {
    nativeRequests.clear();
    const template = document.createElement("template");
    template.innerHTML = html;
    const host = template.content.querySelector("#substrate");
    if (!host || template.content.children.length !== 1)
      throw new Error("A canvas must keep one root with id=substrate.");
    root()?.replaceWith(host);
    sheet.textContent = css;
    activateScripts(host);
  }
  function apply(op: MutationOp) {
    if (op.op === "note") return;
    if (op.op === "freeform")
      throw new Error("Layout changes must be applied by the host.");
    if (op.op === "style") {
      sheet.textContent += `\n${op.css}`;
      return;
    }
    const host = root();
    const targets = [...document.querySelectorAll(op.sel)].filter(
      (node) => node === host || host?.contains(node),
    );
    if (!targets.length)
      throw new Error(`No canvas element matches ${op.sel}.`);
    for (const node of targets) {
      if (op.op === "remove") {
        if (node === host)
          throw new Error("The canvas root cannot be removed.");
        node.remove();
      } else if (op.op === "attr") {
        if (node === host && op.name === "id" && op.value !== "substrate")
          throw new Error("The canvas root must keep id=substrate.");
        node.setAttribute(op.name, op.value);
      } else {
        const template = document.createElement("template");
        template.innerHTML = op.html;
        if (
          node === host &&
          op.op === "replace" &&
          (template.content.children.length !== 1 ||
            !template.content.firstElementChild?.matches("#substrate"))
        )
          throw new Error("A replacement root must keep id=substrate.");
        const elements = [...template.content.children];
        if (op.op === "replace") node.replaceWith(template.content);
        else if (op.op === "append") node.append(template.content);
        else node.prepend(template.content);
        elements.forEach(activateScripts);
      }
    }
    if (!root()) throw new Error("The update removed the canvas root.");
  }
  addEventListener("message", (event) => {
    if (event.source !== parent || !event.isTrusted) return;
    const message = event.data;
    if (message?.type === "canvas:connect" && !nativePort && event.ports[0]) {
      nativePort = event.ports[0];
      sendNative = nativePort.postMessage.bind(nativePort);
      nativePort.onmessage = (response) => {
        const result = response.data;
        const pending = nativeRequests.get(result.requestId);
        if (!pending) return;
        nativeRequests.delete(result.requestId);
        const target = pending;
        target.removeAttribute("aria-busy");
        const detail = {
          stdout: result.stdout ?? "",
          error: result.error ?? null,
        };
        const output = target.dataset.applescriptOutput;
        if (output) {
          const node = root()?.querySelector(output);
          if (node) node.textContent = detail.error ?? detail.stdout;
        }
        target.dispatchEvent(
          new CustomEvent("codexos:applescript", { bubbles: true, detail }),
        );
      };
      sendNative({ type: "canvas:native-ready" });
    } else if (message?.type === "canvas:init") {
      try {
        revision = message.revision;
        lastValidDocument = { html: message.html, css: message.css };
        inputTarget.canvasInputs = message.inputs ?? {};
        hydrate(message.html, message.css);
        updateInputs(message.inputs);
        initialized = true;
        snapshot();
      } catch (error) {
        post({ type: "canvas:error", error: errorText(error) });
      }
    } else if (message?.type === "canvas:ops" && initialized) {
      for (const entry of message.entries) {
        if (entry.id <= revision) continue;
        let previous = lastValidDocument;
        try {
          previous = serializeDocument();
        } catch (error) {
          post({ type: "canvas:error", error: errorText(error) });
        }
        let failure: string | undefined;
        try {
          apply(entry.op);
          serializeDocument();
        } catch (error) {
          failure = errorText(error);
          hydrate(previous.html, previous.css);
        }
        revision = entry.id;
        try {
          snapshot(undefined, failure);
        } catch (error) {
          post({ type: "canvas:error", error: errorText(error) });
        }
      }
    } else if (
      message?.type === "canvas:control" &&
      initialized &&
      typeof message.requestId === "string"
    ) {
      try {
        const host = root();
        if (!host) throw new Error("The app canvas is missing.");
        const result = controlSurface(host, message.request);
        post({
          type: "canvas:control-result",
          requestId: message.requestId,
          result,
        });
      } catch (error) {
        post({
          type: "canvas:control-result",
          requestId: message.requestId,
          error: errorText(error),
        });
      }
    } else if (message?.type === "canvas:inputs") {
      updateInputs(message.inputs);
    } else if (message?.type === "canvas:capture" && initialized) {
      try {
        snapshot(message.requestId);
      } catch (error) {
        post({
          type: "canvas:error",
          error: errorText(error),
          requestId: message.requestId,
        });
      }
    }
  });
  addEventListener("error", (event) =>
    post({ type: "canvas:error", error: (event as ErrorEvent).message }),
  );
  addEventListener("unhandledrejection", (event) =>
    post({
      type: "canvas:error",
      error: errorText((event as PromiseRejectionEvent).reason),
    }),
  );
  document.addEventListener("input", scheduleSave);
  document.addEventListener("change", scheduleSave);
  function openLink(event: MouseEvent) {
    if (
      event.defaultPrevented ||
      (event.type === "auxclick" && event.button !== 1)
    )
      return;
    const link =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>("a[href]")
        : null;
    if (!link || link.getAttribute("href")?.startsWith("#")) return;
    event.preventDefault();
    if (!event.isTrusted) return;
    try {
      post({ type: "canvas:open-link", url: externalWebUrl(link.href) });
    } catch (error) {
      post({ type: "canvas:error", error: errorText(error) });
    }
  }
  document.addEventListener("click", openLink);
  document.addEventListener("auxclick", openLink);
  function runNativeAction(event: Event) {
    if (!event.isTrusted || event.defaultPrevented || !initialized) return;
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-applescript]")
        : null;
    if (
      !target ||
      !root()?.contains(target) ||
      target.getAttribute("aria-busy") === "true"
    )
      return;
    if (
      event.type === "change" &&
      !(
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement
      )
    )
      return;
    if (event.type === "click" && !(target instanceof HTMLButtonElement))
      return;
    event.preventDefault();
    try {
      const script = document.getElementById(target.dataset.applescript ?? "");
      if (
        !script ||
        !root()?.contains(script) ||
        script.getAttribute("type") !== "text/applescript"
      )
        throw new Error(
          "The AppleScript action is missing its text/applescript script element.",
        );
      const args: unknown = JSON.parse(target.dataset.applescriptArgs ?? "[]");
      const selectors: unknown = JSON.parse(
        target.dataset.applescriptInputs ?? "[]",
      );
      if (
        !Array.isArray(args) ||
        !args.every((value) => typeof value === "string") ||
        !Array.isArray(selectors) ||
        !selectors.every((value) => typeof value === "string")
      )
        throw new Error(
          "AppleScript arguments and input selectors must be arrays of strings.",
        );
      const values = selectors.map((selector) => {
        const input = root()?.querySelector(selector);
        if (
          !(
            input instanceof HTMLInputElement ||
            input instanceof HTMLSelectElement ||
            input instanceof HTMLTextAreaElement
          )
        )
          throw new Error(`AppleScript input ${selector} is missing.`);
        return input.value;
      });
      if (!sendNative)
        throw new Error("The native action connection is still opening.");
      const requestId = crypto.randomUUID();
      nativeRequests.set(requestId, target);
      target.setAttribute("aria-busy", "true");
      sendNative({
        type: "canvas:applescript",
        requestId,
        request: { script: script.textContent, args: [...args, ...values] },
      });
    } catch (error) {
      target.dispatchEvent(
        new CustomEvent("codexos:applescript", {
          bubbles: true,
          detail: { stdout: "", error: errorText(error) },
        }),
      );
      post({ type: "canvas:error", error: errorText(error) });
    }
  }
  document.addEventListener("click", runNativeAction);
  document.addEventListener("change", runNativeAction);
  new MutationObserver(scheduleSave).observe(document.body, {
    subtree: true,
    attributes: true,
    childList: true,
    characterData: true,
  });
  post({ type: "canvas:ready" });
})();
