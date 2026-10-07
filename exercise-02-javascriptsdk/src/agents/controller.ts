import Graphic from "@arcgis/core/Graphic.js";
import GraphicsLayer from "@arcgis/core/layers/GraphicsLayer.js";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import * as centroidOperator from "@arcgis/core/geometry/operators/centroidOperator.js";
import { config } from "../config";
import { estimate, SOURCE_LABEL, summarizeCounty } from "../county/data";
import type { AppContext } from "../types";
import { LayerCatalog, requireOrganization } from "./catalog";
import {
  EMBEDDING_FIELDS,
  cosineSimilarity,
  embeddingVector,
  meanVector,
  resolveBookmark,
  uniqueObjectIds,
  validateThreshold,
  type CatalogScope,
  type ObjectId,
} from "./helpers";
import { queryFeaturesByIds } from "./queries";

const numericTypes = new Set(["small-integer", "integer", "big-integer", "single", "double", "long"]);
const countyContextNote =
  "ACS county-context estimates for the counties containing the selected hexagon centroids. These are NOT hexagon-level demographics, and embeddings are not demographic measurements. Counties are deduplicated; no county totals are summed across hexagons.";

export class AssistantController {
  readonly catalog: LayerCatalog;
  private readonly abort = new AbortController();
  private disposed = false;
  private highlights: GraphicsLayer | null = null;
  private similarityRevision = 0;
  private similarityAbort: AbortController | null = null;
  private readonly account: string;

  constructor(private readonly ctx: AppContext) {
    this.account = `${requireOrganization(ctx)}:${ctx.portal.user!.username}`;
    this.catalog = new LayerCatalog(ctx, () => this.assertActive(), this.abort.signal);
  }

  private assertActive() {
    if (this.disposed) throw new Error("This assistant has been closed. Reopen it to continue.");
    const account = `${requireOrganization(this.ctx)}:${this.ctx.portal.user!.username}`;
    if (account !== this.account) {
      throw new Error("The signed-in account changed. Reopen the assistant before continuing.");
    }
  }

  searchLayers(scope: CatalogScope, text: string, start = 1, pageSize = 6) {
    return this.catalog.search(scope, text, start, pageSize);
  }

  addLayer(scope: CatalogScope, handleOrItemId: string) {
    return this.catalog.add(scope, handleOrItemId);
  }

  private async selectedEmbeddingFeatures(minimum: number, returnGeometry: boolean, signal = this.abort.signal) {
    this.assertActive();
    const layer = this.ctx.getEmbeddingLayer();
    if (!layer) {
      throw new Error("The USA geodemographic embedding layer is unavailable. Restore access to it, then select its smaller hexes.");
    }
    await layer.load({ signal });
    this.assertActive();
    const sourceKey = embeddingLayerKey(layer);
    const fields = new Set(layer.fields.map((field) => field.name));
    const missing = EMBEDDING_FIELDS.filter((field) => !fields.has(field));
    if (missing.length) throw new Error(`The geodemographic layer is missing ${missing.length} of its 256 embedding fields.`);
    const selection = this.ctx.getSelection();
    if (selection.some((graphic) => graphic.layer !== layer)) {
      throw new Error("Select only the smaller USA geodemographic hexes, not the veteran aggregate bins or another map layer.");
    }
    const ids = uniqueObjectIds(selection.map((graphic) => graphic.attributes?.[layer.objectIdField]));
    if (ids.length < minimum || ids.length > 20) {
      throw new Error(`Select ${minimum === 1 ? "1–20" : "2–20"} distinct USA geodemographic hexes first.`);
    }
    // Rendering graphics may omit attributes: read authoritative records by object id.
    const features = await queryFeaturesByIds(layer, ids, EMBEDDING_FIELDS, returnGeometry, signal, this.ctx.view.spatialReference);
    signal.throwIfAborted();
    this.assertActive();
    return { layer, ids, features, sourceKey };
  }

  async findSimilar(threshold: number = config.similarityThreshold) {
    this.assertActive();
    validateThreshold(threshold);
    this.similarityAbort?.abort(new Error("This comparison was replaced by a newer request."));
    const revision = ++this.similarityRevision;
    const operation = new AbortController();
    this.similarityAbort = operation;
    const { signal } = operation;
    const timer = setTimeout(() => operation.abort(new Error(`The comparison exceeded ${config.similarityTimeoutMs / 60000} minutes. Zoom in and retry; no partial comparison was returned.`)), config.similarityTimeoutMs);
    const progress = (message: string) => {
      signal.throwIfAborted();
      this.assertActive();
      if (revision !== this.similarityRevision) throw new Error("This comparison was superseded or cleared.");
      this.ctx.onSimilarityProgress?.(message);
    };
    try {
      progress("Loading selected geodemographic hexes...");
      const extent = this.ctx.view.extent?.clone();
      if (!extent) throw new Error("Wait for the map extent to become available.");
      const { layer, ids: selectedIds, features: selected, sourceKey } = await this.selectedEmbeddingFeatures(1, false, signal);
      const reference = meanVector(selected.map((feature) => embeddingVector(feature.attributes)));
      const query = layer.createQuery();
      query.geometry = extent;
      query.spatialRelationship = "intersects";
      const ids = uniqueObjectIds(await layer.queryObjectIds(query, { signal }));
      if (ids.length > config.maxSimilarityCandidates) {
        throw new Error(`The visible extent contains ${ids.length.toLocaleString()} geodemographic hexes, exceeding the ${config.maxSimilarityCandidates.toLocaleString()}-candidate limit. Zoom in and retry; no truncated similarity analysis was performed.`);
      }
      const selectedIdSet = new Set(selectedIds.map(String));
      const candidateIds = ids.filter((id) => !selectedIdSet.has(String(id)));
      progress("Loading comparison hexes...");
      const candidates = await queryFeaturesByIds(layer, candidateIds, EMBEDDING_FIELDS, false, signal);
      const matches: { objectId: ObjectId; score: number }[] = [];
      const excluded: { objectId: ObjectId; reason: string }[] = [];
      for (let index = 0; index < candidates.length; index++) {
        if (index % 200 === 0) {
          progress(`Comparing hexes ${index + 1}/${candidates.length}...`);
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
        }
        signal.throwIfAborted();
        const objectId = candidateIds[index];
        try {
          const score = cosineSimilarity(reference, embeddingVector(candidates[index].attributes));
          if (score >= threshold) matches.push({ objectId, score });
        } catch (error) {
          excluded.push({ objectId, reason: error instanceof Error ? error.message : String(error) });
        }
      }
      matches.sort((left, right) => right.score - left.score);
      if (candidates.length > 0 && excluded.length === candidates.length) {
        throw new Error(`No candidate geodemographic hexes have usable embeddings. ${excluded[0].reason} Try a different map extent.`);
      }
      progress("Highlighting matching hexes...");
      const geometries = await queryFeaturesByIds(layer, matches.map((match) => match.objectId), [], true, signal, this.ctx.view.spatialReference);
      signal.throwIfAborted();
      this.assertActive();
      const current = this.ctx.getSelection();
      const currentIds = uniqueObjectIds(current.map((feature) => feature.attributes?.[layer.objectIdField]));
      if (
        revision !== this.similarityRevision || current.some((feature) => feature.layer !== layer) ||
        currentIds.length !== selectedIds.length || currentIds.some((id) => !selectedIdSet.has(String(id))) ||
        this.ctx.getEmbeddingLayer() !== layer || embeddingLayerKey(layer) !== sourceKey
      ) throw new Error("The selection or source layers changed during the comparison. Retry with the current selection.");
      const byId = new Map(geometries.map((feature) => [String(feature.attributes[layer.objectIdField]), feature]));
      const graphics = matches.map((match) => {
        const feature = byId.get(String(match.objectId))!;
        if (!feature.geometry || feature.geometry.type !== "polygon") throw new Error("A matched geodemographic hex has no polygon geometry.");
        return new Graphic({
          geometry: feature.geometry.clone(),
          attributes: { objectId: match.objectId, cosineScore: match.score },
          symbol: {
            type: "simple-fill",
            color: [32, 205, 221, 0.16],
            outline: { color: [7, 160, 190, 1], width: 2 },
          },
          popupTemplate: {
            title: "Similar geodemographic hex",
            content: [{ type: "fields", fieldInfos: [
              { fieldName: "objectId", label: "Source object id" },
              { fieldName: "cosineScore", label: "Cosine similarity", format: { places: 4 } },
            ] }],
          },
        });
      });
      const nextHighlights = graphics.length
        ? new GraphicsLayer({ title: "Geodemographic similarity (session only)", graphics, listMode: "hide" })
        : null;
      try {
        if (nextHighlights) this.ctx.webMap.add(nextHighlights);
      } catch (error) {
        nextHighlights?.destroy();
        throw error;
      }
      this.removeHighlights();
      this.highlights = nextHighlights;
      this.ctx.onSimilarityResult?.({ matchCount: matches.length, selectedCount: selectedIds.length, threshold });
      this.ctx.onStatus(`${matches.length} similar geodemographic hexes highlighted; ${excluded.length} invalid candidate vectors excluded.`);
      return {
        layer: layer.title,
        method: "Cosine similarity to the arithmetic mean of the selected USA geodemographic hexes' 256-dimensional embedding vectors.",
        threshold,
        extentCandidateCount: ids.length,
        comparedCount: candidates.length - excluded.length,
        selectedCount: selectedIds.length,
        invalidCandidateCount: excluded.length,
        excludedHexes: excluded.slice(0, 50),
        matchCount: matches.length,
        matches: matches.slice(0, 50),
        matchesReturned: Math.min(matches.length, 50),
        note: `All ${matches.length} matches are highlighted as small USA geodemographic hexes; at most 50 matches and 50 exclusion reasons are listed here. Candidates intersect the extent at request start. Scores range from -1 to 1. No veteran-bin aggregation or polygon-overlap analysis is performed. Embeddings are not demographic population estimates or veteran-procedure counts. No hosted data is modified.`,
      };
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      throw error;
    } finally {
      clearTimeout(timer);
      if (revision === this.similarityRevision) {
        this.similarityAbort = null;
        this.ctx.onSimilarityProgress?.(null);
      }
    }
  }

  cancelSimilarity() {
    this.assertActive();
    this.similarityRevision++;
    this.similarityAbort?.abort(new Error("This comparison was cancelled or the selection changed."));
    this.similarityAbort = null;
    this.ctx.onSimilarityProgress?.(null);
    return { cancelled: true, message: "Pending comparison cancelled; the last completed matches are preserved." };
  }

  clearSimilarity() {
    this.cancelSimilarity();
    this.removeHighlights();
    this.ctx.onSimilarityResult?.(null);
    return { cleared: true, message: "Comparison cleared; original map layers and selection were not changed." };
  }

  private removeHighlights() {
    if (!this.highlights) return;
    this.ctx.webMap.remove(this.highlights);
    this.highlights.destroy();
    this.highlights = null;
  }

  async demographics(compare = false) {
    const { ids, features } = await this.selectedEmbeddingFeatures(compare ? 2 : 1, true);
    const countyLayer = this.ctx.countyLayer;
    await countyLayer.load({ signal: this.abort.signal });
    const countyIds: ObjectId[] = [];
    const unmatchedHexagons: ObjectId[] = [];
    for (let index = 0; index < features.length; index++) {
      const feature = features[index];
      if (!feature.geometry || feature.geometry.type !== "polygon") {
        throw new Error("A selected geodemographic hex has no polygon geometry.");
      }
      const query = countyLayer.createQuery();
      query.geometry = centroidOperator.execute(feature.geometry);
      query.spatialRelationship = "intersects";
      const containing = uniqueObjectIds(await countyLayer.queryObjectIds(query, { signal: this.abort.signal }));
      if (containing.length > 1) {
        throw new Error(`Hexagon ${ids[index]} has a centroid on overlapping county boundaries. County context is ambiguous; select a different hexagon.`);
      }
      if (!containing.length) unmatchedHexagons.push(ids[index]);
      countyIds.push(...containing);
    }
    const uniqueCounties = uniqueObjectIds(countyIds);
    if (!uniqueCounties.length) throw new Error("None of the selected hexagon centroids falls within the available ACS counties.");
    const counties = await queryFeaturesByIds(countyLayer, uniqueCounties, ["*"], false, this.abort.signal);
    this.assertActive();
    const dataFields = demographicFields(countyLayer);
    if (!dataFields.length) throw new Error("The county layer exposes no recognized numeric demographic fields with meaningful aliases.");
    const rows = counties.map((feature) => {
      const summary = summarizeCounty(feature.attributes);
      return {
        countyObjectId: feature.attributes[countyLayer.objectIdField] as ObjectId,
        name: summary.name,
        summary,
        values: dataFields.map((field) => ({
          field: field.name,
          label: field.alias || field.name,
          value: estimate(feature.attributes[field.name]),
        })),
      };
    });
    const commonalities = compare ? dataFields.map((field) => {
      const values = counties.map((feature) => estimate(feature.attributes[field.name])).filter((value): value is number => value !== null);
      return {
        field: field.name,
        label: field.alias || field.name,
        countiesWithData: values.length,
        minimum: values.length ? Math.min(...values) : null,
        maximum: values.length ? Math.max(...values) : null,
        unweightedCountyMean: values.length ? values.reduce((sum, value) => sum + value / values.length, 0) : null,
      };
    }) : undefined;
    return {
      source: countyLayer.title,
      sourceUrl: countyLayer.url,
      sourceLabel: SOURCE_LABEL,
      selectedHexagonCount: ids.length,
      uniqueCountyCount: uniqueCounties.length,
      unmatchedHexagons,
      note: countyContextNote,
      comparisonNote: compare
        ? uniqueCounties.length < 2
          ? "All matched hexagons share one county. There is no cross-county comparison; they share the same county context."
          : "Ranges and means compare distinct county estimates, not individual residents or hexagon-level populations. No statistical similarity claim is implied."
        : undefined,
      counties: rows,
      commonalities,
    };
  }

  listBookmarks() {
    this.assertActive();
    const names = this.ctx.webMap.bookmarks.toArray().map((bookmark) => bookmark.name);
    return { bookmarks: names, message: names.length ? "Use an exact name or a unique substring." : "This web map has no bookmarks." };
  }

  async goToBookmark(name: string) {
    this.assertActive();
    const bookmarks = this.ctx.webMap.bookmarks.toArray();
    if (!bookmarks.length) {
      return { navigated: false, message: "This web map has no bookmarks. No navigation was performed." };
    }
    const bookmark = resolveBookmark(bookmarks, name);
    if (!bookmark.viewpoint) throw new Error(`Bookmark "${bookmark.name}" has no usable viewpoint.`);
    await this.ctx.view.goTo(bookmark.viewpoint);
    this.assertActive();
    return { navigated: true, name: bookmark.name, message: `Navigated to bookmark "${bookmark.name}".` };
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.similarityAbort?.abort(new Error("This assistant has been closed."));
    this.similarityAbort = null;
    this.similarityRevision++;
    this.removeHighlights();
    this.ctx.onSimilarityResult?.(null);
    this.ctx.onSimilarityProgress?.(null);
    this.catalog.clear();
  }
}

function embeddingLayerKey(layer: FeatureLayer) {
  return JSON.stringify([layer.url, layer.layerId, layer.definitionExpression, layer.gdbVersion, layer.historicMoment]);
}

function demographicFields(layer: FeatureLayer) {
  return layer.fields.filter((field) =>
    numericTypes.has(field.type) &&
    Boolean(field.alias) &&
    /veteran|population|age|male|female|income|poverty|household|employment|education/i.test(field.alias ?? "") &&
    !/margin of error|standard error|shape[_ ]|objectid/i.test(`${field.name} ${field.alias}`),
  ).slice(0, 60);
}

/** Direct browser tests use real signed-in context; there is no authentication bypass. */
export function createAssistantController(ctx: AppContext) {
  requireOrganization(ctx);
  return new AssistantController(ctx);
}
