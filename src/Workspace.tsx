import { useEffect, useRef, useState } from "react";
import WebMap from "@arcgis/core/WebMap.js";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import type Portal from "@arcgis/core/portal/Portal.js";
import "@arcgis/map-components/components/arcgis-map";
import "@arcgis/map-components/components/arcgis-zoom";
import "@arcgis/map-components/components/arcgis-home";
import "@arcgis/map-components/components/arcgis-expand";
import "@arcgis/map-components/components/arcgis-layer-list";
import "@arcgis/map-components/components/arcgis-legend";
import "@arcgis/ai-components/components/arcgis-assistant";
import "@arcgis/core/assets/esri/themes/light/main.css";
import "@esri/calcite-components/main.css";
import { CountyPanel } from "./county/CountyPanel";
import { createCountyExplorer } from "./county/explorer";
import { getAssistantController, mountAssistant } from "./agents";
import { bindHexSelection } from "./selection";
import { config } from "./config";
import { errorMessage } from "./oauth";
import { createVeteranPopupTemplate } from "./veteran-popup";
import type { CountyExplorer, CountySummary, SimilaritySummary } from "./types";

export default function Workspace({ portal, onSignOut }: { portal: Portal; onSignOut: () => void }) {
  const mapHost = useRef<HTMLDivElement>(null);
  const assistantHost = useRef<HTMLDivElement>(null);
  const county = useRef<CountyExplorer | null>(null);
  const selection = useRef<ReturnType<typeof bindHexSelection> | null>(null);
  const embeddingLayerRef = useRef<FeatureLayer | null>(null);
  const [summary, setSummary] = useState<CountySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [mapReady, setMapReady] = useState(false);
  const [assistantReady, setAssistantReady] = useState(false);
  const [assistantFailed, setAssistantFailed] = useState(false);
  const [status, setStatus] = useState("Opening your veteran map...");
  const [errors, setErrors] = useState<string[]>([]);
  const [selectedCount, setSelectedCount] = useState(0);
  const [selectMode, setSelectMode] = useState(false);
  const [selectionReady, setSelectionReady] = useState(false);
  const [similarityProgress, setSimilarityProgress] = useState<string | null>(null);
  const [comparison, setComparison] = useState<SimilaritySummary | null>(null);
  const [mobilePanel, setMobilePanel] = useState<"map" | "county" | "assistant">("map");

  useEffect(() => {
    const host = mapHost.current;
    const chatHost = assistantHost.current;
    if (!host || !chatHost) return;
    setSelectedCount(0);
    setSelectMode(false);
    setSelectionReady(false);
    setSimilarityProgress(null);
    setComparison(null);
    const chatContainer = chatHost;
    let disposed = false;
    let cleanupAssistant: (() => void) | undefined;
    let cleanupLayerEvents: (() => void) | undefined;
    const fail = (message: string) => {
      if (!disposed) setErrors((previous) => previous.includes(message) ? previous : [...previous.slice(-3), message]);
    };
    const report = (message: string) => { if (!disposed) setStatus(message); };
    const map = document.createElement("arcgis-map");
    map.id = "veteran-map";
    map.setAttribute("aria-label", "Veteran communities and ACS counties");
    const webMap = new WebMap({ portalItem: { id: config.webMapId, portal } });
    map.map = webMap;
    for (const name of ["arcgis-zoom", "arcgis-home"] as const) {
      const control = document.createElement(name);
      control.slot = "top-left";
      map.append(control);
    }
    for (const [name, icon, label] of [
      ["arcgis-layer-list", "layers", "Map layers"],
      ["arcgis-legend", "legend", "Map legend"],
    ] as const) {
      const expand = document.createElement("arcgis-expand");
      expand.slot = "top-right";
      expand.expandIcon = icon;
      expand.expandTooltip = label;
      expand.append(document.createElement(name));
      map.append(expand);
    }
    host.append(map);

    async function initialize() {
      await map.viewOnReady();
      if (disposed) return;
      setMapReady(true);
      const handle = map.view.on("layerview-create-error", (event) => {
        fail(`Layer "${event.layer.title}" could not be drawn: ${errorMessage(event.error)}`);
      });
      cleanupLayerEvents = () => handle.remove();
      const featureLayers = webMap.allLayers.toArray().filter((layer): layer is FeatureLayer => layer instanceof FeatureLayer);
      const layerLoads = await Promise.allSettled(featureLayers.map((layer) => layer.load()));
      if (disposed) return;
      layerLoads.forEach((result, index) => {
        if (result.status === "rejected") fail(`Layer "${featureLayers[index].title}": ${errorMessage(result.reason)}`);
      });
      const embeddingLayer = featureLayers.find((layer) => layer.loaded && (
        layer.portalItem?.id === config.embeddingItemId ||
        layer.url?.toLowerCase().split("/").includes(config.embeddingServiceName)
      ) && layer.fields.some((field) => field.name === "emb_0")) ?? null;
      const veteranLayer = featureLayers.find((layer) => layer.loaded && (
        layer.portalItem?.id === config.veteranItemId ||
        layer.url?.toLowerCase().split("/").includes(config.veteranServiceName)
      )) ?? null;
      embeddingLayerRef.current = embeddingLayer;
      if (embeddingLayer) {
        const binding = bindHexSelection(map, embeddingLayer, (features) => {
          if (disposed) return;
          setSelectedCount(features.length);
          const mounted = chatContainer.querySelector("arcgis-assistant");
          if (mounted) getAssistantController(mounted)?.cancelSimilarity();
        }, fail);
        selection.current = binding;
        setSelectionReady(true);
      } else {
        fail("The USA geodemographic embedding layer is unavailable. Hex selection and similarity require access to that layer; the county map and other agents can still be used.");
      }
      let explorer: CountyExplorer | undefined;
      const assistant = document.createElement("arcgis-assistant");
      assistant.referenceElement = map;
      assistant.heading = "Ask the atlas";
      assistant.description = "";
      assistant.entryMessage = "";
      assistant.suggestedPrompts = [
        "What can you help me do?",
        "Find veteran layers in Living Atlas",
        "Find layers in my organization",
        "Find geodemographic hexes similar to my selection",
      ];
      let assistantInitialized = false;
      try {
        // Restore the authored metadata registry before adding session-only layers.
        const cleanup = await mountAssistant(assistant, {
          view: map.view,
          webMap,
          portal,
          get countyLayer() {
            if (!explorer) throw new Error("County context is still initializing. Try again shortly.");
            return explorer.layer;
          },
          getSelection: () => selection.current?.getSelection() ?? [],
          clearSelection: () => selection.current?.clear(),
          getEmbeddingLayer: () => embeddingLayer,
          onSimilarityProgress: (message) => { if (!disposed) setSimilarityProgress(message); },
          onSimilarityResult: (result) => { if (!disposed) setComparison(result); },
          onStatus: report,
        }, chatContainer);
        if (disposed) { cleanup(); return; }
        cleanupAssistant = cleanup;
        assistantInitialized = true;
        setAssistantReady(true);
      } catch (error) {
        if (disposed) return;
        setAssistantFailed(true);
        fail(`Assistant initialization failed: ${errorMessage(error)}`);
      }
      if (veteranLayer) veteranLayer.popupTemplate = createVeteranPopupTemplate();
      try {
        explorer = await createCountyExplorer(map.view, (value) => {
          if (!disposed) { setSummary(value); setLoading(false); }
        }, fail, veteranLayer);
      } catch (error) {
        setLoading(false);
        throw new Error(`County explorer could not load: ${errorMessage(error)}`);
      }
      if (disposed) { explorer.dispose(); return; }
      county.current = explorer;
      report(assistantInitialized
        ? "Ready to explore. Hover over a county or ask the atlas."
        : "The map and county insights are ready. The assistant could not initialize; see the error above.");
    }
    initialize().catch((error: unknown) => {
      if (!disposed) { setLoading(false); fail(errorMessage(error)); report("Some features could not start. See the message above."); }
    });
    return () => {
      disposed = true;
      cleanupAssistant?.();
      cleanupLayerEvents?.();
      selection.current?.dispose();
      selection.current = null;
      county.current?.dispose();
      county.current = null;
      chatHost.replaceChildren();
      map.remove();
      embeddingLayerRef.current = null;
    };
  }, [portal]);

  function toggleSelectMode() {
    const next = !selectMode;
    setSelectMode(next);
    selection.current?.setEnabled(next);
    if (next) {
      const layer = embeddingLayerRef.current;
      if (layer) layer.visible = true;
      setStatus("Selection mode: click the smaller USA geodemographic hexes to compare (up to 20). Click again to deselect.");
    } else setStatus("County exploration mode. Hover over the map for local insights.");
  }

  async function selectCounty(geoid: string) {
    try {
      await county.current?.selectCounty(geoid);
    } catch (error) {
      setErrors((previous) => [...previous.slice(-3), errorMessage(error)]);
    }
  }

  function updateComparison(clear: boolean) {
    try {
      const mounted = assistantHost.current?.querySelector("arcgis-assistant");
      const controller = mounted ? getAssistantController(mounted) : null;
      if (!controller) throw new Error("The assistant is not ready. Try again shortly.");
      if (clear) controller.clearSimilarity();
      else controller.cancelSimilarity();
    } catch (error) {
      setErrors((previous) => [...previous.slice(-3), errorMessage(error)]);
    }
  }

  return <div className="app-shell" data-panel={mobilePanel}>
    <header className="app-header">
      <a className="brand" href="/" aria-label="Veteran Atlas home"><span className="brand-mark">VA</span><span>VETERAN ATLAS<small>COUNTY EXPLORER</small></span></a>
      <div className="account"><span title={portal.user?.username}>{portal.user?.fullName || portal.user?.username}</span><button onClick={onSignOut}>Sign out</button></div>
    </header>
    <nav className="mobile-tabs" aria-label="Workspace panels">
      {(["map", "county", "assistant"] as const).map((panel) => <button key={panel}
        aria-current={mobilePanel === panel ? "page" : undefined} onClick={() => setMobilePanel(panel)}>{panel}</button>)}
    </nav>
    <div className="error-stack">
      {errors.map((error) => <div key={error} className="workspace-error" role="alert">
        <span>{error}</span><button aria-label="Dismiss message" onClick={() => setErrors((items) => items.filter((item) => item !== error))}>×</button>
      </div>)}
    </div>
    <main className="workspace-grid">
      <aside className="county-sidebar" aria-label="County insights">
        <CountyPanel summary={summary} loading={loading} onSelectCounty={(geoid) => void selectCounty(geoid)}
          onReset={() => county.current?.reset()} />
      </aside>
      <section className="map-panel" aria-label="Interactive veteran map">
        <div className="map-toolbar">
          <strong>Veteran communities</strong>
          <button className={selectMode ? "active-mode" : ""} disabled={!selectionReady}
            title="Select USA geodemographic hexes"
            aria-pressed={selectMode} onClick={toggleSelectMode}>Select hexes</button>
        </div>
        <div className="map-host" ref={mapHost} />
        {!mapReady && <div className="map-loading" role="status"><span className="spinner" /> Loading your web map...</div>}
        {(selectMode || selectedCount > 0 || similarityProgress || comparison) && <div className="map-hint">
          <span className="selected-count">{selectedCount} hex{selectedCount === 1 ? "" : "es"} selected</span>
          {selectedCount > 0 && <button onClick={() => selection.current?.clear()}>Clear selection</button>}
          {comparison && <div className="comparison-summary">
            <span role="status">
              <strong>Last comparison</strong>
              {comparison.matchCount.toLocaleString()} matches · {comparison.selectedCount} reference hex{comparison.selectedCount === 1 ? "" : "es"} · ≥ {comparison.threshold}
            </span>
            <button onClick={() => updateComparison(true)}>Clear comparison</button>
          </div>}
          {similarityProgress && <>
            <span className="comparison-progress" role="status">{similarityProgress}</span>
            <button aria-label="Cancel similarity comparison" onClick={() => updateComparison(false)}>Cancel</button>
          </>}
        </div>}
      </section>
      <aside className="assistant-panel" aria-label="AI map assistant">
        {!assistantReady && <p className="assistant-loading" role="status">
          {assistantFailed ? "Assistant unavailable. See the error above, then reload to retry." : "Preparing your map assistants..."}
        </p>}
        <div className="assistant-host" ref={assistantHost} />
      </aside>
    </main>
    <div className="sr-only" role="status">{status}</div>
  </div>;
}
