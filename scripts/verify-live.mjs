import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { connectLive } from "./live-client.mjs";

const live = await connectLive();
const report = { checkedAt: new Date().toISOString(), checks: [] };
try {
  const state = await live.evaluate(`(() => {
    const map = document.querySelector("arcgis-map");
    return {
      gate: !!document.querySelector('[data-testid="sign-in-gate"]'),
      ready: map?.ready,
      webMapId: map?.map?.portalItem?.id,
      layers: map?.map?.allLayers.map(layer => ({
        title: layer.title, loaded: layer.loaded, type: layer.type
      })).toArray(),
      agents: [...document.querySelectorAll("arcgis-assistant > *")].map(el => el.agent?.name)
    };
  })()`);
  assert.equal(state.gate, false, "The signed-in gate must be removed, not merely hidden.");
  assert.equal(state.ready, true, "The real ArcGIS map must be ready.");
  assert.equal(state.webMapId, "dab72f4380b94f78836b4f68c54e66a5");
  assert.equal(state.agents.filter(Boolean).length, 9);
  assert(state.layers.some(layer => layer.title.includes("ACS") && layer.loaded));
  report.checks.push({ name: "Signed-in gate, original web map and nine registered agents", passed: true });

  const target = await live.evaluate(`(async () => {
    const view = document.querySelector("arcgis-map").view;
    view.center = [-86.65, 32.54];
    view.zoom = 8;
    await new Promise(resolve => setTimeout(resolve, 2500));
    const start = performance.now();
    while (view.updating && performance.now() - start < 20000) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    const bounds = view.container.getBoundingClientRect();
    return { x: bounds.x + view.width / 2, y: bounds.y + view.height / 2 };
  })()`);
  const start = Date.now();
  await live.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...target });
  const hover = await live.evaluate(`(async () => {
    const start = performance.now();
    while (document.querySelector(".county-panel__selection h3")?.textContent !== "Autauga County, AL"
      && performance.now() - start < 1500) {
      await new Promise(resolve => setTimeout(resolve, 16));
    }
    return {
      name: document.querySelector(".county-panel__selection h3")?.textContent,
      text: document.querySelector(".county-sidebar")?.innerText,
      bars: document.querySelectorAll("svg.county-age__chart rect").length
    };
  })()`);
  const elapsedMs = Date.now() - start;
  assert.equal(hover.name, "Autauga County, AL");
  for (const value of ["4,842", "10.8%", "44,688", "234", "1,609", "1,187", "958", "854"]) {
    assert(hover.text.includes(value), `County data must show ${value}.`);
  }
  assert(elapsedMs < 1500, `Hover took ${elapsedMs}ms.`);
  assert(hover.bars >= 5, "Chart must render age-band bars.");
  await new Promise(resolve => setTimeout(resolve, 600));
  await live.screenshot("test-results/live-county-hover.png");
  report.checks.push({ name: "Real county hover, exact ACS values and age chart", passed: true, elapsedMs });

  await live.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 20, y: 20 });
  await new Promise(resolve => setTimeout(resolve, 100));
  const reset = await live.evaluate(`({
    name: document.querySelector(".county-panel__selection h3")?.textContent,
    text: document.querySelector(".county-sidebar")?.innerText
  })`);
  assert.equal(reset.name, "U.S. county aggregate");
  assert(reset.text.includes("16,185,883"));
  assert(reset.text.includes("260,112,316"));
  report.checks.push({ name: "Pointer leave restores exact national aggregate", passed: true });
  console.log(JSON.stringify(report, null, 2));
  await writeFile("test-results/live-verification.json", JSON.stringify(report, null, 2));
} finally {
  await live.close();
}
