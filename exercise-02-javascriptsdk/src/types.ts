import type Graphic from "@arcgis/core/Graphic.js";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import type Portal from "@arcgis/core/portal/Portal.js";
import type MapView from "@arcgis/core/views/MapView.js";
import type WebMap from "@arcgis/core/WebMap.js";

export interface CountySummary {
  geoid: string;
  name: string;
  adultPopulation: number | null;
  veterans: number | null;
  veteranPercent: number | null;
  ageBands: { label: string; count: number | null }[];
  sourceLabel: string;
  isAggregate: boolean;
}

export interface CountyExplorer {
  layer: FeatureLayer;
  reset: () => void;
  selectCounty: (geoid: string) => Promise<void>;
  dispose: () => void;
}

export interface SimilaritySummary {
  matchCount: number;
  selectedCount: number;
  threshold: number;
}

export interface AppContext {
  view: MapView;
  webMap: WebMap;
  portal: Portal;
  countyLayer: FeatureLayer;
  getSelection: () => Graphic[];
  clearSelection: () => void;
  getEmbeddingLayer: () => FeatureLayer | null;
  onSimilarityProgress?: (message: string | null) => void;
  onSimilarityResult?: (summary: SimilaritySummary | null) => void;
  onStatus: (message: string) => void;
}
