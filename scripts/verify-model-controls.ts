import assert from "node:assert/strict";
import type { Snapshot } from "../src/types";
import { desktopClient, showWorkspace } from "./desktop-client";

const client = await desktopClient();
await showWorkspace(client, true);
const snapshot = () => client.evaluate<Snapshot>("window.astra.snapshot()");
try {
  const before = await snapshot();
  assert.equal(before.status, "ready");
  for (const label of ["Model", "Reasoning effort", "Model speed"]) {
    await client.evaluate(
      `document.querySelector(${JSON.stringify(`button[data-setting="${label}"]`)}).click()`,
    );
    await Bun.sleep(100);
    const menu = await client.evaluate<{
      label: string;
      options: number;
      top: number;
      bottom: number;
      selected: number;
    }>(
      `(() => {const menu=document.querySelector('.choice-menu:popover-open');const rect=menu.getBoundingClientRect();return {label:menu.getAttribute('aria-label'),options:menu.querySelectorAll('[role=option]').length,selected:menu.querySelectorAll('[aria-selected=true]').length,top:rect.top,bottom:rect.bottom};})()`,
    );
    assert.equal(menu.label, label);
    assert.ok(menu.options > 0);
    assert.equal(menu.selected, 1);
    assert.ok(menu.top >= 0);
    if (label === "Reasoning effort")
      await client.screenshot("test-results/reasoning-menu.png");
    await client.call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "ArrowDown",
      code: "ArrowDown",
      windowsVirtualKeyCode: 40,
    });
    assert.equal(
      await client.evaluate('document.activeElement.getAttribute("role")'),
      "option",
    );
    for (const [key, code] of [
      ["Home", 36],
      ["End", 35],
      ["ArrowUp", 38],
    ]) {
      await client.call("Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        code: key,
        windowsVirtualKeyCode: code,
      });
      const focus = await client.evaluate<{
        index: number;
        length: number;
      }>(`(() => {
        const options = [...document.querySelector('.choice-menu:popover-open').querySelectorAll('[role=option]')];
        return {index:options.indexOf(document.activeElement),length:options.length};
      })()`);
      const expected =
        key === "Home"
          ? 0
          : key === "End"
            ? focus.length - 1
            : (focus.length - 2 + focus.length) % focus.length;
      assert.equal(
        focus.index,
        expected,
        `${key} must focus the appropriate option`,
      );
    }
    await client.call("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await client.call("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Escape",
      code: "Escape",
      windowsVirtualKeyCode: 27,
    });
    await Bun.sleep(100);
    assert.equal(
      await client.evaluate(
        'Boolean(document.querySelector(".choice-menu:popover-open"))',
      ),
      false,
    );
  }
  const after = await snapshot();
  assert.equal(after.model, before.model);
  assert.equal(after.reasoningEffort, before.reasoningEffort);
  assert.equal(after.serviceTier, before.serviceTier);
  assert.equal(client.errors.length, 0);
  await client.screenshot("test-results/model-controls.png");
  console.log(
    "MODEL_MENUS_VERIFIED",
    JSON.stringify({
      readableMenus: true,
      keyboardNavigation: true,
      selectionUnchanged: true,
      errors: 0,
    }),
  );
} finally {
  client.close();
}
