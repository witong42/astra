// DOM mutation and script activation adapted from Substrate's public/shell.js.

import { externalWebUrl } from "./navigation";
import type { MutationOp } from "./substrate-protocol";

(() => {
  const SAVE_INTERVAL_MS = 300;
  const MAX_DOCUMENT_BYTES = 512 * 1024;
  const sheet = document.getElementById("mutations") as HTMLStyleElement;
  let revision = 0;
  let initialized = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const root = () => document.getElementById("substrate");
  const post = (value: unknown) => parent.postMessage(value, "*");
  const errorText = (error: unknown) =>
    error instanceof Error ? error.message : String(error);
  const inputTarget = window as unknown as { canvasInputs: unknown };
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
    if (new TextEncoder().encode(html + css).byteLength > MAX_DOCUMENT_BYTES)
      throw new Error(
        "The canvas exceeds its 512 KB limit. Ask Codex to simplify it.",
      );
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
    if (event.source !== parent) return;
    const message = event.data;
    if (message?.type === "canvas:init") {
      try {
        revision = message.revision;
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
        const previous = serializeDocument();
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
  new MutationObserver(scheduleSave).observe(document.body, {
    subtree: true,
    attributes: true,
    childList: true,
    characterData: true,
  });
  post({ type: "canvas:ready" });
})();
