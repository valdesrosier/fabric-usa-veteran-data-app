import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppContext } from "../types";

const mocks = vi.hoisted(() => ({ itemLoad: vi.fn(), fromPortalItem: vi.fn() }));
vi.mock("@arcgis/core/layers/Layer.js", () => ({
  default: class { static fromPortalItem = mocks.fromPortalItem; },
}));
vi.mock("@arcgis/core/layers/GroupLayer.js", () => ({ default: class {} }));
vi.mock("@arcgis/core/portal/PortalItem.js", () => ({
  default: class {
    id: string;
    type = "Feature Service";
    title = "County service";
    constructor(properties: { id: string }) { this.id = properties.id; }
    async load() { Object.assign(this, await mocks.itemLoad(this.id)); return this; }
  },
}));
import { LayerCatalog } from "./catalog";

const itemId = "a".repeat(32);
function setup() {
  const layers: unknown[] = [];
  const queryItems = vi.fn().mockResolvedValue({
    results: [{ id: itemId, type: "Feature Service", title: "County service", owner: "owner" }],
    total: 24,
    nextQueryParams: { start: 7 },
  });
  const layer = {
    type: "feature",
    title: "County service",
    portalItem: { id: itemId },
    load: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn(),
  };
  mocks.fromPortalItem.mockResolvedValue(layer);
  const add = vi.fn((value: unknown) => { layers.push(value); });
  const remove = vi.fn((value: unknown) => { layers.splice(layers.indexOf(value), 1); });
  const whenLayerView = vi.fn().mockResolvedValue({});
  const ctx = {
    portal: { user: { username: "tester", orgId: "myOrg" }, queryItems },
    webMap: { allLayers: layers, add, remove },
    view: { whenLayerView },
  } as unknown as AppContext;
  const catalog = new LayerCatalog(ctx, () => {}, new AbortController().signal);
  return { catalog, ctx, queryItems, layer, add, remove, whenLayerView, layers };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.itemLoad.mockResolvedValue({});
});

describe("shared layer catalog", () => {
  it("returns real candidate identities and supports subsequent pages", async () => {
    const { catalog, queryItems } = setup();
    const first = await catalog.search("livingAtlas", "veterans");
    expect(first.candidates[0]).toMatchObject({ itemId, title: "County service", owner: "owner", handle: "atlas-1" });
    expect(first.nextStart).toBe(7);
    await catalog.search("livingAtlas", "veterans", first.nextStart!);
    expect(queryItems.mock.calls[1][0]).toMatchObject({ start: 7 });
    expect(queryItems.mock.calls[1][0].query).toContain("groupdesignations:livingatlas");
  });

  it("rejects unauthenticated catalog use", async () => {
    const { catalog, ctx, queryItems } = setup();
    ctx.portal.user = null;
    await expect(catalog.search("organization", "veterans")).rejects.toThrow("Sign in");
    await expect(catalog.add("organization", itemId)).rejects.toThrow("Sign in");
    expect(queryItems).not.toHaveBeenCalled();
  });

  it("revalidates scope for explicit ids before creating a layer", async () => {
    const { catalog, queryItems, add } = setup();
    queryItems.mockResolvedValue({ results: [], total: 0 });
    await expect(catalog.add("organization", itemId)).rejects.toThrow("could not be verified");
    expect(queryItems.mock.calls[0][0].query).toContain('(orgid:"myOrg")');
    expect(queryItems.mock.calls[0][0].query).toContain(`id:"${itemId}"`);
    expect(mocks.fromPortalItem).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it("does not allow a candidate from the other catalog", async () => {
    const { catalog } = setup();
    const result = await catalog.search("organization", "");
    await expect(catalog.add("livingAtlas", result.candidates[0].handle)).rejects.toThrow("other catalog");
  });

  it("reports unsupported scene services explicitly", async () => {
    const { catalog, add } = setup();
    mocks.itemLoad.mockResolvedValue({ type: "Scene Service" });
    await expect(catalog.add("livingAtlas", itemId)).rejects.toThrow("Unsupported item type");
    expect(add).not.toHaveBeenCalled();
  });

  it("loads before adding and does not add duplicates", async () => {
    const { catalog, layer, add } = setup();
    const result = await catalog.add("organization", itemId);
    expect(result.added).toBe(true);
    expect(layer.load.mock.invocationCallOrder[0]).toBeLessThan(add.mock.invocationCallOrder[0]);
    expect((await catalog.add("organization", itemId)).added).toBe(false);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("does not add a layer after a load error", async () => {
    const { catalog, layer, add } = setup();
    layer.load.mockRejectedValue(new Error("Service unavailable"));
    await expect(catalog.add("livingAtlas", itemId)).rejects.toThrow("Service unavailable");
    expect(add).not.toHaveBeenCalled();
    expect(layer.destroy).toHaveBeenCalled();
  });

  it("rolls back when a layer cannot create a 2D layer view", async () => {
    const { catalog, layer, remove, whenLayerView } = setup();
    whenLayerView.mockRejectedValue(new Error("Unsupported layer view"));
    await expect(catalog.add("livingAtlas", itemId)).rejects.toThrow("Unsupported layer view");
    expect(remove).toHaveBeenCalledWith(layer);
    expect(layer.destroy).toHaveBeenCalled();
  });
});
