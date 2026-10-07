import { describe, expect, it, vi } from "vitest";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import type SpatialReference from "@arcgis/core/geometry/SpatialReference.js";
import { queryFeaturesByIds } from "./queries";

function layerFixture(maxRecords = 200, omit?: number) {
  const queryFeatures = vi.fn(async (query: { objectIds: number[] }) => ({
    exceededTransferLimit: query.objectIds.length > maxRecords,
    features: query.objectIds.slice(0, maxRecords).filter((id) => id !== omit).map((id) => ({
      attributes: { OBJECTID: id, emb_0: id },
    })),
  }));
  return {
    layer: { objectIdField: "OBJECTID", createQuery: () => ({}), queryFeatures } as unknown as FeatureLayer,
    queryFeatures,
  };
}

describe("complete object-id retrieval", () => {
  it("retrieves beyond the first batch and deduplicates requested ids", async () => {
    const { layer, queryFeatures } = layerFixture();
    const ids = Array.from({ length: 405 }, (_, index) => index + 1);
    const result = await queryFeaturesByIds(layer, [...ids, 1], ["emb_0"], false);
    expect(result).toHaveLength(405);
    expect(queryFeatures).toHaveBeenCalledTimes(3);
  });
  it("recursively splits service-truncated batches", async () => {
    const { layer } = layerFixture(2);
    const result = await queryFeaturesByIds(layer, [1, 2, 3, 4, 5], ["emb_0"], false);
    expect(result.map((feature) => feature.attributes.OBJECTID)).toEqual([1, 2, 3, 4, 5]);
  });
  it("rejects missing records instead of pretending a partial result is complete", async () => {
    const { layer } = layerFixture(200, 2);
    await expect(queryFeaturesByIds(layer, [1, 2], [], false)).rejects.toThrow("omitted 1");
  });
  it("rejects an irreducible transfer-limit response", async () => {
    const { layer } = layerFixture(0);
    await expect(queryFeaturesByIds(layer, [1], [], false)).rejects.toThrow("single-feature");
  });
  it("does not issue requests after cancellation", async () => {
    const { layer, queryFeatures } = layerFixture();
    const abort = new AbortController();
    abort.abort();
    await expect(queryFeaturesByIds(layer, [1], [], false, abort.signal)).rejects.toThrow("cancelled");
    expect(queryFeatures).not.toHaveBeenCalled();
  });
  it("requests source polygons in the same spatial reference as the larger bins", async () => {
    const { layer, queryFeatures } = layerFixture();
    const spatialReference = { wkid: 3857 } as SpatialReference;
    await queryFeaturesByIds(layer, [1], ["emb_0"], true, undefined, spatialReference);
    expect(queryFeatures.mock.calls[0][0]).toMatchObject({
      returnGeometry: true, outSpatialReference: spatialReference,
    });
  });
});
