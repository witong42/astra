import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Astra } from "../src/Astra";
import { INITIAL_VOICE } from "../src/voice";
import { desktopClient } from "./desktop-client";

const client = await desktopClient();
const selector = ".astra-hover-probe .astra-home-orb";
const markup = renderToStaticMarkup(
  createElement(Astra, {
    compact: true,
    voice: { ...INITIAL_VOICE, status: "speaking", level: 0.6 },
  }),
);
let nodeId: number | undefined;
const appearance = () =>
  client.evaluate<{
    background: string;
    radius: string;
    filter: string;
    overflow: string;
    canvasClip: string;
  }>(
    `(()=>{const orb=document.querySelector(${JSON.stringify(selector)});const style=getComputedStyle(orb);return {background:style.backgroundColor,radius:style.borderRadius,filter:style.filter,overflow:style.overflow,canvasClip:getComputedStyle(orb.querySelector('canvas.astra-galaxy')).clipPath}})()`,
  );
try {
  await client.evaluate(
    `(()=>{const probe=document.createElement('div');probe.className='astra-hover-probe';probe.style.cssText='position:fixed;left:-10000px;top:0;--hover:#eeefe9';probe.inert=true;probe.innerHTML=${JSON.stringify(markup)};document.body.append(probe)})()`,
  );
  const resting = await appearance();
  assert.equal(resting.background, "rgb(255, 255, 255)");
  await client.call("DOM.enable");
  await client.call("CSS.enable");
  const document = await client.call("DOM.getDocument", { depth: 0 });
  const found = await client.call("DOM.querySelector", {
    nodeId: (document.root as { nodeId: number }).nodeId,
    selector,
  });
  nodeId = Number(found.nodeId);
  assert.ok(nodeId);
  await client.call("CSS.forcePseudoState", {
    nodeId,
    forcedPseudoClasses: ["hover"],
  });
  const hovered = await appearance();
  assert.equal(
    hovered.background,
    resting.background,
    "Hover must preserve the white circular core.",
  );
  assert.equal(hovered.radius, "50%");
  assert.equal(hovered.canvasClip, "circle(50%)");
  assert.equal(
    hovered.filter,
    "none",
    "Hover must not filter the halo's rectangular layer.",
  );
  assert.equal(
    hovered.overflow,
    "visible",
    "The halo must remain outside the clipped galaxy.",
  );
  assert.equal(client.errors.length, 0);
  const result = {
    circularHover: true,
    whiteCorePreserved: true,
    haloUnclipped: true,
    rendererErrors: client.errors.length,
  };
  await Bun.write(
    "test-results/astra-orb-hover-verification.json",
    JSON.stringify(result, null, 2),
  );
  console.log("ORB_VERIFIED", JSON.stringify(result));
} finally {
  if (nodeId)
    await client.call("CSS.forcePseudoState", {
      nodeId,
      forcedPseudoClasses: [],
    });
  await client.evaluate(
    "document.querySelector('.astra-hover-probe')?.remove()",
  );
  client.close();
}
