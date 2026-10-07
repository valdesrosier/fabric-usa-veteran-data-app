import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../types";
import { config } from "../config";

vi.mock("@arcgis/core/Graphic.js", () => ({
  default: class { constructor(properties: object) { Object.assign(this, properties); } },
}));
vi.mock("@arcgis/core/layers/GraphicsLayer.js", () => ({
  default: class {
    destroy = vi.fn();
    constructor(properties: object) { Object.assign(this, properties); }
  },
}));
vi.mock("@arcgis/core/layers/Layer.js", () => ({ default: class {} }));
vi.mock("@arcgis/core/layers/GroupLayer.js", () => ({ default: class {} }));
vi.mock("@arcgis/core/portal/PortalItem.js", () => ({ default: class {} }));
vi.mock("@arcgis/core/geometry/operators/centroidOperator.js", () => ({
  execute: (geometry: { centroid: object }) => geometry.centroid,
}));
import { createAssistantController } from "./controller";

const vector = (first = 1) => [first, ...new Array<number>(255).fill(0)];
const attributes = (id: number, first = 1) => ({
  OBJECTID: id,
  ...Object.fromEntries(vector(first).map((value, index) => [`emb_${index}`, value])),
});

function fixture() {
  const records = new Map([1, 2, 3].map((id) => [id, {
    attributes: attributes(id),
    geometry: { type: "polygon", hex: id, centroid: { type: "point" }, clone() { return this; } },
  }]));
  const layer = {
    title: "USA Geodemographic Embeddings 2026",
    definitionExpression: "",
    objectIdField: "OBJECTID",
    fields: Array.from({ length: 256 }, (_, index) => ({ name: `emb_${index}` })),
    load: vi.fn().mockResolvedValue(undefined),
    createQuery: () => ({}),
    queryObjectIds: vi.fn().mockResolvedValue([1, 2, 3]),
    queryFeatures: vi.fn(async (query: { objectIds: number[]; outFields?: string[]; returnGeometry?: boolean }, _options?: { signal?: AbortSignal }) => ({
      features: query.objectIds.map((id) => records.get(id)),
      exceededTransferLimit: false,
    })),
  };
  const countyLayer = {
    title: "ACS county estimates",
    url: "https://example.invalid/FeatureServer/1",
    objectIdField: "OBJECTID",
    fields: [
      { name: "B21001_002E", alias: "Veteran population", type: "double" },
      { name: "B21001_001E", alias: "Adult population", type: "double" },
      { name: "Shape_Area", alias: "Shape area", type: "double" },
    ],
    load: vi.fn().mockResolvedValue(undefined),
    createQuery: () => ({}),
    queryObjectIds: vi.fn().mockResolvedValue([101]),
    queryFeatures: vi.fn().mockResolvedValue({
      exceededTransferLimit: false,
      features: [{ attributes: { OBJECTID: 101, NAME: "Test County", B21001_002E: 120, B21001_001E: 1800 } }],
    }),
  };
  const selection = [1, 2].map((id) => ({ layer, attributes: { OBJECTID: id } }));
  const ctx = {
    portal: { user: { username: "tester", orgId: "myOrg" } },
    getEmbeddingLayer: vi.fn(() => layer),
    getSelection: vi.fn(() => selection),
    countyLayer,
    webMap: { add: vi.fn(), remove: vi.fn(), bookmarks: { toArray: () => [] } },
    view: { extent: { clone: () => ({ type: "extent" }) } },
    onStatus: vi.fn(),
    onSimilarityProgress: vi.fn(),
    onSimilarityResult: vi.fn(),
  } as unknown as AppContext;
  return { ctx, layer, countyLayer, selection, records, controller: createAssistantController(ctx) };
}

beforeEach(() => vi.clearAllMocks());

describe("direct USA geodemographic hex similarity", () => {
  it("rejects an account change instead of retaining the previous account's catalog context", async () => {
    const { controller, ctx } = fixture();
    ctx.portal.user!.username = "another-user";
    await expect(controller.findSimilar()).rejects.toThrow("account changed");
  });

  it("compares existing vectors and fetches geometries only for matching small hexes", async () => {
    const { controller, layer, ctx, records } = fixture();
    const result = await controller.findSimilar();
    expect(result.matchCount).toBe(1);
    expect(result.matches).toEqual([{ objectId: 3, score: 1 }]);
    expect(layer.queryFeatures.mock.calls.map(([query]) => ({
      ids: query.objectIds, geometry: query.returnGeometry,
    }))).toEqual([
      { ids: [1, 2], geometry: false },
      { ids: [3], geometry: false },
      { ids: [3], geometry: true },
    ]);
    expect(layer.queryFeatures.mock.calls[0][0].outFields).toContain("emb_255");
    expect(result.note).toContain("No veteran-bin aggregation");
    expect(ctx.webMap.add).toHaveBeenCalledTimes(1);
    expect(ctx.webMap.add).toHaveBeenCalledWith(expect.objectContaining({
      graphics: [expect.objectContaining({ geometry: records.get(3)!.geometry })],
    }));
    expect(ctx.onSimilarityProgress).toHaveBeenLastCalledWith(null);
    expect(ctx.onSimilarityResult).toHaveBeenLastCalledWith({ matchCount: 1, selectedCount: 2, threshold: 0.8 });
    controller.dispose();
    expect(ctx.webMap.remove).toHaveBeenCalledTimes(1);
    await expect(controller.findSimilar()).rejects.toThrow("closed");
  });

  it("rejects veteran-bin selection and unavailable embedding layers", async () => {
    const { ctx, controller, selection, layer } = fixture();
    selection[0].layer = {} as typeof selection[0]["layer"];
    await expect(controller.findSimilar()).rejects.toThrow("only the smaller USA geodemographic hexes");
    selection[0].layer = layer;
    vi.mocked(ctx.getEmbeddingLayer).mockReturnValue(null);
    await expect(controller.findSimilar()).rejects.toThrow("embedding layer is unavailable");
  });

  it("preserves completed matches on reselection and clears only the comparison when asked", async () => {
    const { controller, ctx, selection } = fixture();
    await controller.findSimilar();
    selection.splice(0, 1);
    controller.cancelSimilarity();
    expect(ctx.webMap.remove).not.toHaveBeenCalled();
    expect(ctx.onSimilarityResult).toHaveBeenLastCalledWith({ matchCount: 1, selectedCount: 2, threshold: 0.8 });
    controller.clearSimilarity();
    expect(ctx.webMap.remove).toHaveBeenCalledTimes(1);
    expect(ctx.onSimilarityResult).toHaveBeenLastCalledWith(null);
    expect(selection).toHaveLength(1);
  });

  it("keeps the last completed matches when a new query fails", async () => {
    const { controller, ctx, layer } = fixture();
    await controller.findSimilar();
    layer.queryFeatures.mockRejectedValueOnce(new Error("Access denied"));
    await expect(controller.findSimilar()).rejects.toThrow("Access denied");
    expect(ctx.webMap.add).toHaveBeenCalledTimes(1);
    expect(ctx.webMap.remove).not.toHaveBeenCalled();
    expect(ctx.onSimilarityResult).toHaveBeenLastCalledWith({ matchCount: 1, selectedCount: 2, threshold: 0.8 });
    controller.dispose();
  });

  it("keeps matches during a new request and cancellation", async () => {
    const { controller, ctx, layer, records } = fixture();
    await controller.findSimilar();
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    layer.queryFeatures.mockImplementationOnce(async (query) => {
      entered();
      await blocked;
      return { features: query.objectIds.map((id) => records.get(id)), exceededTransferLimit: false };
    });
    const pending = controller.findSimilar();
    await ready;
    expect(ctx.webMap.remove).not.toHaveBeenCalled();
    controller.cancelSimilarity();
    release();
    await expect(pending).rejects.toThrow("cancelled");
    expect(ctx.webMap.add).toHaveBeenCalledTimes(1);
    expect(ctx.webMap.remove).not.toHaveBeenCalled();
    expect(ctx.onSimilarityResult).toHaveBeenLastCalledWith({ matchCount: 1, selectedCount: 2, threshold: 0.8 });
    controller.dispose();
  });

  it("replaces old matches after a successful zero-match comparison", async () => {
    const { controller, ctx, records } = fixture();
    await controller.findSimilar();
    records.get(3)!.attributes = attributes(3, -1);
    const result = await controller.findSimilar(0.9);
    expect(result.matchCount).toBe(0);
    expect(ctx.webMap.remove).toHaveBeenCalledTimes(1);
    expect(ctx.onSimilarityResult).toHaveBeenLastCalledWith({ matchCount: 0, selectedCount: 2, threshold: 0.9 });
    controller.dispose();
    expect(ctx.webMap.remove).toHaveBeenCalledTimes(1);
  });

  it("requires a complete embedding field set", async () => {
    const { controller, layer } = fixture();
    layer.fields.pop();
    await expect(controller.findSimilar()).rejects.toThrow("missing 1");
    expect(layer.queryFeatures).not.toHaveBeenCalled();
  });

  it("does not truncate an extent exceeding the candidate cap", async () => {
    const { controller, layer, ctx } = fixture();
    layer.queryObjectIds.mockResolvedValue(Array.from({ length: 5001 }, (_, id) => id + 1));
    await expect(controller.findSimilar()).rejects.toThrow("Zoom in");
    expect(layer.queryFeatures).toHaveBeenCalledTimes(1);
    expect(ctx.webMap.add).not.toHaveBeenCalled();
  });

  it("rejects invalid selected vectors and reports unusable candidates", async () => {
    const { controller, records, ctx } = fixture();
    records.get(1)!.attributes = attributes(1, 0);
    await expect(controller.findSimilar()).rejects.toThrow("zero-norm");
    records.get(1)!.attributes = attributes(1);
    records.get(3)!.attributes = attributes(3, 0);
    await expect(controller.findSimilar()).rejects.toThrow("No candidate geodemographic hexes");
    expect(ctx.webMap.add).not.toHaveBeenCalled();
  });

  it("uses the arithmetic-mean vector and never invents matches below threshold", async () => {
    const { controller, records, ctx } = fixture();
    records.get(3)!.attributes = attributes(3, -1);
    const result = await controller.findSimilar(0.8);
    expect(result.matchCount).toBe(0);
    expect(result.comparedCount).toBe(1);
    expect(ctx.webMap.add).not.toHaveBeenCalled();
  });
  it("uses selected vectors even when their hexes are outside the current viewport", async () => {
    const { controller, layer } = fixture();
    layer.queryObjectIds.mockResolvedValue([3]);
    const result = await controller.findSimilar();
    expect(result.selectedCount).toBe(2);
    expect(result.extentCandidateCount).toBe(1);
    expect(result.matchCount).toBe(1);
    expect(layer.queryFeatures.mock.calls[0][0].objectIds).toEqual([1, 2]);
  });
  it("cancels pending vector queries and does not install late highlights", async () => {
    const { controller, ctx, layer, records } = fixture();
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => { entered = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    layer.queryFeatures.mockImplementationOnce(async (query) => {
      entered();
      await blocked;
      return { features: query.objectIds.map((id) => records.get(id)), exceededTransferLimit: false };
    });
    const pending = controller.findSimilar();
    await ready;
    const signal = layer.queryFeatures.mock.calls[0][1]!.signal!;
    controller.clearSimilarity();
    release();
    await expect(pending).rejects.toThrow("cancelled");
    expect(signal.aborted).toBe(true);
    expect(ctx.webMap.add).not.toHaveBeenCalled();
    expect(ctx.onSimilarityProgress).toHaveBeenLastCalledWith(null);
  });
  it("does not publish results after a selection change", async () => {
    const { controller, selection, ctx, layer } = fixture();
    layer.queryObjectIds.mockImplementationOnce(async () => { selection.splice(0, 1); return [1, 2, 3]; });
    await expect(controller.findSimilar()).rejects.toThrow("selection or source layers changed");
    expect(ctx.webMap.add).not.toHaveBeenCalled();
  });
  it("does not publish results after an embedding filter change", async () => {
    const { controller, layer, ctx } = fixture();
    layer.queryObjectIds.mockImplementationOnce(async () => { layer.definitionExpression = "OBJECTID > 2"; return [1, 2, 3]; });
    await expect(controller.findSimilar()).rejects.toThrow("selection or source layers changed");
    expect(ctx.webMap.add).not.toHaveBeenCalled();
  });
  it("propagates query failures without returning a partial success", async () => {
    const { controller, ctx, layer } = fixture();
    layer.queryFeatures.mockRejectedValueOnce(new Error("Access denied"));
    await expect(controller.findSimilar()).rejects.toThrow("Access denied");
    expect(ctx.webMap.add).not.toHaveBeenCalled();
    expect(ctx.onSimilarityProgress).toHaveBeenLastCalledWith(null);
  });
  it("aborts requests that exceed the configured extended time limit", async () => {
    vi.useFakeTimers();
    try {
      const { controller, ctx, layer } = fixture();
      let entered!: () => void;
      const ready = new Promise<void>((resolve) => { entered = resolve; });
      layer.queryFeatures.mockImplementationOnce((_query, options) => new Promise((_resolve, reject) => {
        const signal = options!.signal!;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        entered();
      }));
      const pending = controller.findSimilar();
      const rejection = expect(pending).rejects.toThrow(`${config.similarityTimeoutMs / 60000} minutes`);
      await ready;
      await vi.advanceTimersByTimeAsync(60000);
      expect(ctx.onSimilarityProgress).not.toHaveBeenLastCalledWith(null);
      await vi.advanceTimersByTimeAsync(config.similarityTimeoutMs - 60000);
      await rejection;
      expect(ctx.webMap.add).not.toHaveBeenCalled();
      expect(ctx.onSimilarityProgress).toHaveBeenLastCalledWith(null);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("county context, not hexagon demographics", () => {
  it("centroid-queries counties, deduplicates county totals, and keeps aliases", async () => {
    const { controller, countyLayer } = fixture();
    const result = await controller.demographics(true);
    expect(result.selectedHexagonCount).toBe(2);
    expect(result.uniqueCountyCount).toBe(1);
    expect(result.counties[0].values[0]).toEqual({ field: "B21001_002E", label: "Veteran population", value: 120 });
    expect(result.counties[0].summary).toMatchObject({ adultPopulation: 1800, veterans: 120 });
    expect(result.counties[0].summary.ageBands.every((band) => band.count === null)).toBe(true);
    expect(result.sourceLabel).toContain("2020–2024");
    expect(result.note).toContain("NOT hexagon-level");
    expect(result.comparisonNote).toContain("no cross-county comparison");
    expect(countyLayer.queryObjectIds.mock.calls[0][0]).toMatchObject({ geometry: { type: "point" }, spatialRelationship: "intersects" });
  });

  describe("maps without bookmarks", () => {
    it("reports an empty bookmark collection without pretending to navigate or throwing", async () => {
      const { controller } = fixture();
      expect(controller.listBookmarks()).toMatchObject({ bookmarks: [], message: "This web map has no bookmarks." });
      await expect(controller.goToBookmark("Texas")).resolves.toEqual({
        navigated: false,
        message: "This web map has no bookmarks. No navigation was performed.",
      });
    });
  });

  it("requires 2–20 distinct selected hexagons for comparisons", async () => {
    const { controller, selection } = fixture();
    selection[1].attributes.OBJECTID = 1;
    await expect(controller.demographics(true)).rejects.toThrow("2–20");
  });

  it("rejects ambiguous county intersections instead of double counting", async () => {
    const { controller, countyLayer } = fixture();
    countyLayer.queryObjectIds.mockResolvedValue([101, 102]);
    await expect(controller.demographics()).rejects.toThrow("ambiguous");
  });
});
