import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type MapView from "@arcgis/core/views/MapView.js";
import type Layer from "@arcgis/core/layers/Layer.js";
import GroupLayer from "@arcgis/core/layers/GroupLayer.js";
import { COUNT_FIELDS } from "./data";
import { createCountyExplorer } from "./explorer";

const service = vi.hoisted(() => ({
  load: vi.fn(),
  query: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("@arcgis/core/layers/FeatureLayer.js", () => ({
  default: class {
    objectIdField = "OBJECTID";
    outFields: string[] = [];
    constructor(properties: object) { Object.assign(this, properties); }
    load = service.load;
    queryFeatures = service.query;
    createQuery() { return {}; }
    destroy = service.destroy;
  },
}));
vi.mock("@arcgis/core/layers/GroupLayer.js", () => ({
  default: class {
    constructor(properties: object) { Object.assign(this, properties); }
  },
}));

function deferred<T>() {
  let resolve!: (result: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function aggregateResult() {
  return {
    features: [{
      attributes: Object.fromEntries([
        ["county_count", 2],
        ...COUNT_FIELDS.flatMap((field) => [[`count_${field}`, 2], [`sum_${field}`, 100]]),
      ]),
    }],
  };
}

function attributes(geoid: string) {
  return {
    ...Object.fromEntries(COUNT_FIELDS.map((field) => [field, 10])),
    OBJECTID: Number(geoid),
    GEOID: geoid,
    NAME: "Example County",
    B21001_calc_pctVetsE: 10,
  };
}

function harness() {
  const listeners = new Map<string, (point?: { x: number; y: number }) => void>();
  const owned = new Map<string, { remove: () => void }>();
  const highlightRemove = vi.fn();
  const layerView = { highlight: vi.fn(() => ({ remove: highlightRemove })) };
  const map = { add: vi.fn(), remove: vi.fn(), layers: { indexOf: vi.fn().mockReturnValue(1) } };
  const view = {
    map,
    destroyed: false,
    spatialReference: { wkid: 3857 },
    highlights: { add: vi.fn(), remove: vi.fn() },
    animation: null,
    hitTest: vi.fn(),
    goTo: vi.fn().mockResolvedValue(undefined),
    whenLayerView: vi.fn().mockResolvedValue(layerView),
    addHandles: vi.fn((handle, group) => owned.set(group, handle)),
    removeHandles: vi.fn((group) => {
      owned.get(group)?.remove();
      owned.delete(group);
    }),
    on: vi.fn((name, callback) => {
      listeners.set(name, callback);
      return { remove: () => listeners.delete(name) };
    }),
  };
  return {
    view,
    map,
    layerView,
    highlightRemove,
    listeners,
    destroyView() {
      view.destroyed = true;
      [...owned.values()].forEach((handle) => handle.remove());
    },
  };
}

let frames: Map<number, FrameRequestCallback>;
let frameId = 0;
function flushFrame() {
  const current = [...frames.values()];
  frames.clear();
  current.forEach((callback) => callback(0));
}
async function flushPromises() {
  for (let count = 0; count < 12; count++) await Promise.resolve();
}

beforeEach(() => {
  vi.clearAllMocks();
  service.load.mockResolvedValue(undefined);
  service.query.mockResolvedValue(aggregateResult());
  frames = new Map();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});

afterEach(() => vi.unstubAllGlobals());

describe("county explorer event lifecycle", () => {
  it("inserts counties below the veteran bins rather than above them", async () => {
    const h = harness();
    const veteranLayer = { parent: null } as unknown as Layer;
    const explorer = await createCountyExplorer(h.view as unknown as MapView, vi.fn(), vi.fn(), veteranLayer);
    expect(h.map.layers.indexOf).toHaveBeenCalledWith(veteranLayer);
    expect(h.map.add).toHaveBeenCalledWith(explorer.layer, 1);
    explorer.dispose();
  });

  it("inserts counties below the containing group when the veteran bins are nested", async () => {
    const h = harness();
    const group = new GroupLayer({ title: "Veteran group" });
    const veteranLayer = { parent: group } as unknown as Layer;
    const explorer = await createCountyExplorer(h.view as unknown as MapView, vi.fn(), vi.fn(), veteranLayer);
    expect(h.map.layers.indexOf).toHaveBeenCalledWith(group);
    expect(h.map.add).toHaveBeenCalledWith(explorer.layer, 1);
    explorer.dispose();
  });

  it("coalesces pointer moves into one hit test and uses attributes without a network query", async () => {
    const h = harness();
    const onChange = vi.fn();
    const explorer = await createCountyExplorer(h.view as unknown as MapView, onChange, vi.fn());
    const graphic = { layer: explorer.layer, attributes: attributes("01001"), geometry: {} };
    h.view.hitTest.mockResolvedValue({ results: [{ type: "graphic", graphic }] });
    h.listeners.get("pointer-move")!({ x: 1, y: 2 });
    h.listeners.get("pointer-move")!({ x: 3, y: 4 });
    flushFrame();
    await flushPromises();
    expect(h.view.hitTest).toHaveBeenCalledTimes(1);
    expect(h.view.hitTest.mock.calls[0][0]).toEqual({ x: 3, y: 4 });
    expect(service.query).toHaveBeenCalledTimes(1); // Only the national aggregate.
    expect(onChange.mock.lastCall?.[0].geoid).toBe("01001");
    expect(h.layerView.highlight).toHaveBeenCalledWith(graphic, {
      name: expect.stringMatching(/^county-explorer-/),
    });
    expect(h.view.highlights.add.mock.calls[0][0].color.toHex()).toBe("#4c7ee8");
    explorer.dispose();
    expect(h.view.highlights.remove).toHaveBeenCalledWith(h.view.highlights.add.mock.calls[0][0]);
  });

  it("lets a new hover win while a previous hit test is still unresolved", async () => {
    const h = harness();
    const onChange = vi.fn();
    const explorer = await createCountyExplorer(h.view as unknown as MapView, onChange, vi.fn());
    const slow = deferred<unknown>();
    h.view.hitTest.mockReturnValueOnce(slow.promise).mockResolvedValueOnce({
      results: [{ type: "graphic", graphic: { layer: explorer.layer, attributes: attributes("01003") } }],
    });
    h.listeners.get("pointer-move")!({ x: 1, y: 2 });
    flushFrame();
    h.listeners.get("pointer-move")!({ x: 3, y: 4 });
    flushFrame();
    await flushPromises();
    expect(onChange.mock.lastCall?.[0].geoid).toBe("01003");
    slow.resolve({
      results: [{ type: "graphic", graphic: { layer: explorer.layer, attributes: attributes("01001") } }],
    });
    await flushPromises();
    expect(onChange.mock.lastCall?.[0].geoid).toBe("01003");
    explorer.dispose();
  });

  it("does not freeze on a slow county query or resurrect that county after pointer leave", async () => {
    const h = harness();
    const onChange = vi.fn();
    const explorer = await createCountyExplorer(h.view as unknown as MapView, onChange, vi.fn());
    const slow = deferred<unknown>();
    service.query.mockReturnValueOnce(slow.promise);
    h.view.hitTest.mockResolvedValueOnce({
      results: [{ type: "graphic", graphic: { layer: explorer.layer, attributes: { GEOID: "01001" } } }],
    }).mockResolvedValueOnce({
      results: [{ type: "graphic", graphic: { layer: explorer.layer, attributes: attributes("01003") } }],
    });
    h.listeners.get("pointer-move")!({ x: 1, y: 2 });
    flushFrame();
    await flushPromises();
    h.listeners.get("pointer-move")!({ x: 3, y: 4 });
    flushFrame();
    await flushPromises();
    expect(onChange.mock.lastCall?.[0].geoid).toBe("01003");
    h.listeners.get("pointer-leave")!();
    expect(onChange.mock.lastCall?.[0].isAggregate).toBe(true);
    slow.resolve({ features: [{ attributes: attributes("01001"), geometry: {} }] });
    await flushPromises();
    expect(onChange.mock.lastCall?.[0].isAggregate).toBe(true);
    expect(h.highlightRemove).toHaveBeenCalled();
    explorer.dispose();
  });

  it("queries geometry for keyboard selection, navigates, and disposes all owned resources", async () => {
    const h = harness();
    const onChange = vi.fn();
    const explorer = await createCountyExplorer(h.view as unknown as MapView, onChange, vi.fn());
    const graphic = { attributes: attributes("01001"), geometry: { type: "polygon" } };
    service.query.mockResolvedValueOnce({ features: [graphic] });
    await explorer.selectCounty("01001");
    expect(service.query.mock.lastCall?.[0]).toMatchObject({
      where: "GEOID = '01001'", returnGeometry: true,
    });
    expect(h.view.goTo).toHaveBeenCalledWith(graphic.geometry, expect.objectContaining({
      duration: 750, signal: expect.any(AbortSignal),
    }));
    expect(onChange.mock.lastCall?.[0].geoid).toBe("01001");
    h.listeners.get("pointer-move")!({ x: 1, y: 2 });
    explorer.dispose();
    explorer.dispose();
    expect(frames.size).toBe(0);
    expect(h.listeners.size).toBe(0);
    expect(h.highlightRemove).toHaveBeenCalledTimes(1);
    expect(h.map.remove).toHaveBeenCalledWith(explorer.layer);
    expect(service.destroy).toHaveBeenCalledTimes(1);
    expect(service.query.mock.calls[0][1].signal.aborted).toBe(true);
    const count = onChange.mock.calls.length;
    await explorer.selectCounty("01001");
    explorer.reset();
    expect(onChange).toHaveBeenCalledTimes(count);
  });

  it("invalidates an in-flight keyboard query on reset", async () => {
    const h = harness();
    const onChange = vi.fn();
    const explorer = await createCountyExplorer(h.view as unknown as MapView, onChange, vi.fn());
    const slow = deferred<unknown>();
    service.query.mockReturnValueOnce(slow.promise);
    const selecting = explorer.selectCounty("01001");
    explorer.reset();
    slow.resolve({ features: [{ attributes: attributes("01001"), geometry: {} }] });
    await selecting;
    expect(onChange.mock.lastCall?.[0].isAggregate).toBe(true);
    expect(h.layerView.highlight).not.toHaveBeenCalled();
    expect(h.view.goTo).not.toHaveBeenCalled();
    explorer.dispose();
  });

  it("aborts a queued navigation on reset even before its animation exists", async () => {
    const h = harness();
    const explorer = await createCountyExplorer(h.view as unknown as MapView, vi.fn(), vi.fn());
    service.query.mockResolvedValueOnce({
      features: [{ attributes: attributes("01001"), geometry: {} }],
    });
    const movement = deferred<void>();
    h.view.goTo.mockReturnValueOnce(movement.promise);
    const selecting = explorer.selectCounty("01001");
    await flushPromises();
    const options = h.view.goTo.mock.lastCall![1];
    expect(options.signal.aborted).toBe(false);
    explorer.reset();
    expect(options.signal.aborted).toBe(true);
    movement.reject(new DOMException("Aborted", "AbortError"));
    await selecting;
    explorer.dispose();
  });

  it("does not let a late national aggregate overwrite an active county", async () => {
    const h = harness();
    const onChange = vi.fn();
    const slow = deferred<unknown>();
    service.query.mockReturnValueOnce(slow.promise);
    const initializing = createCountyExplorer(h.view as unknown as MapView, onChange, vi.fn());
    await flushPromises();
    const layer = h.map.add.mock.calls[0][0];
    h.view.hitTest.mockResolvedValueOnce({
      results: [{ type: "graphic", graphic: { layer, attributes: attributes("01001") } }],
    });
    h.listeners.get("pointer-move")!({ x: 1, y: 2 });
    flushFrame();
    await flushPromises();
    expect(onChange.mock.lastCall?.[0].geoid).toBe("01001");
    slow.resolve(aggregateResult());
    const explorer = await initializing;
    expect(onChange.mock.lastCall?.[0].geoid).toBe("01001");
    explorer.reset();
    expect(onChange.mock.lastCall?.[0].isAggregate).toBe(true);
    explorer.dispose();
  });

  it("cleans up even when the view is destroyed before initialization completes", async () => {
    const h = harness();
    const load = deferred<unknown>();
    service.load.mockReturnValueOnce(load.promise);
    const onChange = vi.fn();
    const initializing = createCountyExplorer(h.view as unknown as MapView, onChange, vi.fn());
    h.destroyView();
    load.resolve(undefined);
    await expect(initializing).rejects.toMatchObject({ name: "AbortError" });
    expect(service.destroy).toHaveBeenCalledTimes(1);
    expect(h.map.add).not.toHaveBeenCalled();
    expect(h.listeners.size).toBe(0);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});
