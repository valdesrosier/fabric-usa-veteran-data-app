import type Graphic from "@arcgis/core/Graphic.js";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import type SpatialReference from "@arcgis/core/geometry/SpatialReference.js";
import { uniqueObjectIds, type ObjectId } from "./helpers";

/**
 * Object-id retrieval avoids offset pagination races and service record limits.
 * A server-truncated batch is split until every requested id is accounted for.
 */
export async function queryFeaturesByIds(
  layer: FeatureLayer,
  ids: ObjectId[],
  outFields: string[],
  returnGeometry: boolean,
  signal?: AbortSignal,
  outSpatialReference?: SpatialReference,
): Promise<Graphic[]> {
  const uniqueIds = uniqueObjectIds(ids);
  const all: Graphic[] = [];
  const fetchBatch = async (batch: ObjectId[]): Promise<Graphic[]> => {
    if (signal?.aborted) throw new Error("The assistant operation was cancelled.");
    const query = layer.createQuery();
    query.objectIds = batch;
    query.outFields = [...new Set([layer.objectIdField, ...outFields])];
    query.returnGeometry = returnGeometry;
    if (outSpatialReference) query.outSpatialReference = outSpatialReference;
    const result = await layer.queryFeatures(query, { signal });
    if (result.exceededTransferLimit) {
      if (batch.length === 1) {
        throw new Error("The service truncated even a single-feature query; no complete result is available.");
      }
      const middle = Math.ceil(batch.length / 2);
      return [...await fetchBatch(batch.slice(0, middle)), ...await fetchBatch(batch.slice(middle))];
    }
    const byId = new Map<string, Graphic>();
    for (const feature of result.features) {
      const id = feature.attributes?.[layer.objectIdField];
      if (id === null || id === undefined) throw new Error("A service response omitted its object id.");
      byId.set(String(id), feature);
    }
    const missing = batch.filter((id) => !byId.has(String(id)));
    if (missing.length) {
      throw new Error(`The service omitted ${missing.length} requested feature(s). Refresh the selection or try again; partial results were not used.`);
    }
    return batch.map((id) => byId.get(String(id))!);
  };
  for (let offset = 0; offset < uniqueIds.length; offset += 200) {
    all.push(...await fetchBatch(uniqueIds.slice(offset, offset + 200)));
  }
  return all;
}
