import type { ArcgisMap } from "@arcgis/map-components/components/arcgis-map";
import FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import Color from "@arcgis/core/Color.js";
import HighlightOptions from "@arcgis/core/views/support/HighlightOptions.js";
import type Graphic from "@arcgis/core/Graphic.js";
import type FeatureLayerView from "@arcgis/core/views/layers/FeatureLayerView.js";
import { errorMessage } from "./oauth";

export function bindHexSelection(
  map: ArcgisMap,
  layer: FeatureLayer,
  onChange: (selection: Graphic[]) => void,
  onError: (message: string) => void,
) {
  const selected = new Map<number, Graphic>();
  let enabled = false;
  let disposed = false;
  let highlight: { remove(): void } | undefined;
  let layerView: FeatureLayerView | undefined;
  let sequence = 0;
  let popupState: { view: boolean; layer: boolean } | null = null;
  const view = map.view;
  const restorePopups = () => {
    if (!popupState) return;
    view.popupEnabled = popupState.view;
    layer.popupEnabled = popupState.layer;
    popupState = null;
  };
  view.highlights.add(new HighlightOptions({ name: "hex-selection", color: new Color("#7250ad"), haloOpacity: 1, fillOpacity: 0.18 }));

  const refresh = () => {
    highlight?.remove();
    highlight = layerView?.highlight([...selected.keys()], { name: "hex-selection" });
    onChange([...selected.values()]);
  };
  const clear = () => { sequence++; selected.clear(); refresh(); };
  const handle = view.on("click", async (event) => {
    if (!enabled || disposed) return;
    const ticket = ++sequence;
    try {
      event.stopPropagation();
      view.closePopup();
      const result = await view.hitTest(event, { include: [layer] });
      if (disposed || ticket !== sequence) return;
      const hit = result.results.find((entry) => entry.type === "graphic" && entry.graphic.layer === layer);
      if (!hit || hit.type !== "graphic") return;
      const id = hit.graphic.attributes[layer.objectIdField];
      if (typeof id !== "number") throw new Error("This geodemographic hex has no usable object ID.");
      layerView ??= await view.whenLayerView(layer);
      if (disposed || ticket !== sequence) return;
      if (selected.has(id)) selected.delete(id);
      else {
        if (selected.size >= 20) {
          onError("Select at most 20 geodemographic hexes. Clear a selection before adding more.");
          return;
        }
        selected.set(id, hit.graphic);
      }
      refresh();
    } catch (error) {
      if (!disposed) onError(`Hex selection: ${errorMessage(error)}`);
    }
  });
  return {
    clear,
    getSelection: () => [...selected.values()],
    setEnabled(value: boolean) {
      if (disposed || value === enabled) return;
      sequence++;
      enabled = value;
      if (value) {
        popupState = { view: view.popupEnabled, layer: layer.popupEnabled };
        view.popupEnabled = false;
        layer.popupEnabled = false;
        view.closePopup();
      } else restorePopups();
    },
    dispose() {
      disposed = true;
      sequence++;
      handle.remove();
      highlight?.remove();
      restorePopups();
      const option = view.highlights.find((entry) => entry.name === "hex-selection");
      if (option) view.highlights.remove(option);
    },
  };
}
