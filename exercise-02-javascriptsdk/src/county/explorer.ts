import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import GroupLayer from "@arcgis/core/layers/GroupLayer.js";
import type Layer from "@arcgis/core/layers/Layer.js";
import Color from "@arcgis/core/Color.js";
import HighlightOptions from "@arcgis/core/views/support/HighlightOptions.js";
import type Graphic from "@arcgis/core/Graphic.js";
import type MapView from "@arcgis/core/views/MapView.js";
import type ViewAnimation from "@arcgis/core/views/ViewAnimation.js";
import type FeatureLayerView from "@arcgis/core/views/layers/FeatureLayerView.js";
import { config } from "../config";
import type { CountyExplorer, CountySummary } from "../types";
import {
  COUNTY_FIELDS,
  COUNTY_WHERE,
  aggregateStatisticDefinitions,
  hasCountyAttributes,
  isCountyGeoid,
  summarizeAggregateStatistics,
  summarizeCounty,
} from "./data";
import { LatestRequest } from "./latest";

interface CachedCounty {
  graphic: Graphic;
  summary: CountySummary;
  queriedGeometry: boolean;
}

interface Removable {
  remove: () => void;
}

export async function createCountyExplorer(
  view: MapView,
  onChange: (summary: CountySummary | null) => void,
  onError: (message: string) => void,
  belowLayer?: Layer | null,
): Promise<CountyExplorer> {
  const map = view.map;
  if (!map || view.destroyed) throw new Error("The map is not ready for county exploration.");

  const layer = new FeatureLayer({
    url: config.countyUrl,
    title: "County boundaries · ACS 2020–2024",
    outFields: COUNTY_FIELDS,
    definitionExpression: COUNTY_WHERE,
    popupEnabled: false,
    listMode: "hide",
    renderer: {
      type: "simple",
      symbol: {
        type: "simple-fill",
        color: [22, 124, 128, 0.012],
        outline: { color: [16, 43, 53, 0.22], width: 0.45 },
      },
    },
  });
  const requests = new LatestRequest();
  const lifecycle = new AbortController();
  const handles: Removable[] = [];
  const cache = new Map<string, CachedCounty>();
  const pending = new Map<string, Promise<CachedCounty | null>>();
  const handleGroup = `county-explorer-${crypto.randomUUID()}`;
  const hoverStyle = new HighlightOptions({
    name: handleGroup,
    color: new Color("#4c7ee8"),
    haloOpacity: 1,
    fillOpacity: 0.08,
  });
  view.highlights.add(hoverStyle);
  let layerView: FeatureLayerView | null = null;
  let highlight: Removable | null = null;
  let highlightedGeoid: string | null = null;
  let national: CountySummary | null = null;
  let activeGeoid: string | null = null;
  let frame: number | null = null;
  let latestPoint: { x: number; y: number; generation: number } | null = null;
  let navigation: ViewAnimation | null = null;
  let navigationAbort: AbortController | null = null;
  let disposed = false;

  const clearHighlight = () => {
    highlight?.remove();
    highlight = null;
    highlightedGeoid = null;
  };
  const stopNavigation = () => {
    navigationAbort?.abort();
    navigationAbort = null;
    navigation?.stop();
    navigation = null;
  };
  const cancelFrame = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    latestPoint = null;
  };
  const showDefault = () => {
    clearHighlight();
    if (activeGeoid !== null) {
      activeGeoid = null;
      onChange(national);
    }
  };
  const reset = () => {
    if (disposed) return;
    requests.next();
    cancelFrame();
    stopNavigation();
    clearHighlight();
    activeGeoid = null;
    onChange(national);
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    requests.dispose();
    lifecycle.abort();
    cancelFrame();
    stopNavigation();
    clearHighlight();
    if (!view.destroyed) view.highlights.remove(hoverStyle);
    handles.forEach((handle) => handle.remove());
    handles.length = 0;
    cache.clear();
    pending.clear();
    map.remove(layer);
    layer.destroy();
    view.removeHandles(handleGroup);
  };
  view.addHandles({ remove: dispose }, handleGroup);

  const isLive = (generation: number) =>
    !disposed && !view.destroyed && requests.isCurrent(generation);

  const showCounty = (county: CachedCounty, generation: number) => {
    if (!isLive(generation) || !layerView) return;
    if (highlightedGeoid !== county.summary.geoid) {
      clearHighlight();
      highlight = layerView.highlight(county.graphic, { name: handleGroup });
      highlightedGeoid = county.summary.geoid;
    }
    if (activeGeoid !== county.summary.geoid) {
      activeGeoid = county.summary.geoid;
      onChange(county.summary);
    }
  };

  const queryCounty = (geoid: string): Promise<CachedCounty | null> => {
    const cached = cache.get(geoid);
    if (cached?.queriedGeometry && cached.graphic.geometry) return Promise.resolve(cached);
    const existing = pending.get(geoid);
    if (existing) return existing;
    const query = layer.createQuery();
    query.where = `GEOID = '${geoid}'`;
    query.outFields = [...COUNTY_FIELDS, layer.objectIdField];
    query.returnGeometry = true;
    query.outSpatialReference = view.spatialReference;
    const promise = layer.queryFeatures(query, { signal: lifecycle.signal })
      .then((result) => {
        const graphic = result.features[0];
        if (!graphic || disposed) return null;
        const county = { graphic, summary: summarizeCounty(graphic.attributes), queriedGeometry: true };
        cache.set(geoid, county);
        return county;
      })
      .finally(() => pending.delete(geoid));
    pending.set(geoid, promise);
    return promise;
  };

  const inspectPoint = async (point: { x: number; y: number; generation: number }) => {
    try {
      const result = await view.hitTest({ x: point.x, y: point.y }, { include: layer });
      if (!isLive(point.generation)) return;
      const hit = result.results.find(
        (candidate) => candidate.type === "graphic" && candidate.graphic.layer === layer,
      );
      if (!hit || hit.type !== "graphic") {
        showDefault();
        return;
      }
      const graphic = hit.graphic;
      const geoid: unknown = graphic.attributes.GEOID;
      if (typeof geoid !== "string" || !isCountyGeoid(geoid)) {
        showDefault();
        return;
      }
      let county = cache.get(geoid);
      if (!county && hasCountyAttributes(graphic.attributes)) {
        county = { graphic, summary: summarizeCounty(graphic.attributes), queriedGeometry: false };
        cache.set(geoid, county);
      }
      if (county) {
        showCounty(county, point.generation);
      } else {
        // Never keep the previous county visible while a different county loads.
        showDefault();
        const queried = await queryCounty(geoid);
        if (queried) showCounty(queried, point.generation);
      }
    } catch (error) {
      if (isLive(point.generation) && !isAbortError(error)) {
        showDefault();
        onError("County details could not be loaded. Try another county or use the county selector.");
      }
    }
  };

  const queuePoint = (event: { x: number; y: number }) => {
    if (disposed) return;
    stopNavigation();
    latestPoint = { x: event.x, y: event.y, generation: requests.next() };
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      const point = latestPoint;
      latestPoint = null;
      if (point && isLive(point.generation)) void inspectPoint(point);
    });
  };

  const selectCounty = async (geoid: string) => {
    if (disposed) return;
    const generation = requests.next();
    cancelFrame();
    stopNavigation();
    if (!isCountyGeoid(geoid)) {
      onError("Enter a five-digit county FIPS code in the 50 states or Washington, DC.");
      return;
    }
    showDefault();
    try {
      const county = await queryCounty(geoid);
      if (!isLive(generation)) return;
      if (!county) {
        onError("That county was not found in the ACS boundary layer.");
        return;
      }
      showCounty(county, generation);
      if (county.graphic.geometry) {
        const controller = new AbortController();
        navigationAbort = controller;
        const movement = view.goTo(county.graphic.geometry, {
          duration: 750,
          signal: controller.signal,
        });
        const currentNavigation = view.animation ?? null;
        navigation = currentNavigation;
        try {
          await movement;
        } finally {
          if (navigation === currentNavigation) navigation = null;
          if (navigationAbort === controller) navigationAbort = null;
        }
      }
    } catch (error) {
      if (isLive(generation) && !isAbortError(error)) {
        onError("The selected county could not be loaded or located. Please try again.");
      }
    }
  };

  try {
    onChange(null);
    await layer.load({ signal: lifecycle.signal });
    lifecycle.signal.throwIfAborted();
    layer.outFields = [...COUNTY_FIELDS, layer.objectIdField];
    let anchor = belowLayer;
    while (anchor?.parent instanceof GroupLayer) anchor = anchor.parent;
    const position = anchor ? map.layers.indexOf(anchor) : -1;
    map.add(layer, position >= 0 ? position : undefined);
    layerView = await view.whenLayerView(layer) as FeatureLayerView;
    lifecycle.signal.throwIfAborted();
    handles.push(
      view.on("pointer-move", queuePoint),
      view.on("click", queuePoint),
      view.on("pointer-leave", reset),
    );

    try {
      const query = layer.createQuery();
      query.where = COUNTY_WHERE;
      query.returnGeometry = false;
      query.outStatistics = aggregateStatisticDefinitions(layer.objectIdField);
      const result = await layer.queryFeatures(query, { signal: lifecycle.signal });
      lifecycle.signal.throwIfAborted();
      if (!result.features[0]) throw new Error("No county totals returned.");
      national = summarizeAggregateStatistics(result.features[0].attributes);
      if (activeGeoid === null) onChange(national);
    } catch (error) {
      if (disposed || isAbortError(error)) throw error;
      onError("The U.S. county aggregate is unavailable. You can still explore individual counties.");
    }

    return { layer, reset, selectCounty, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
