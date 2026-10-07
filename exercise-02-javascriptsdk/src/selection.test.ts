import { describe, expect, it, vi } from "vitest";
import type { ArcgisMap } from "@arcgis/map-components/components/arcgis-map";
import type FeatureLayer from "@arcgis/core/layers/FeatureLayer.js";
import type HighlightOptions from "@arcgis/core/views/support/HighlightOptions.js";
import { bindHexSelection } from "./selection";

function fixture(popupEnabled = true) {
  type Click = { x: number; y: number; stopPropagation: () => void };
  let click!: (event: Click) => Promise<void>;
  const styles: HighlightOptions[] = [];
  const layer = { popupEnabled: true, objectIdField: "OBJECTID" };
  const graphic = { layer, attributes: { OBJECTID: 1 } };
  const view = {
    popupEnabled,
    closePopup: vi.fn(),
    hitTest: vi.fn().mockResolvedValue({ results: [{ type: "graphic", graphic }] }),
    whenLayerView: vi.fn().mockResolvedValue({ highlight: vi.fn(() => ({ remove: vi.fn() })) }),
    highlights: {
      add: (style: HighlightOptions) => styles.push(style),
      find: (predicate: (style: HighlightOptions) => boolean) => styles.find(predicate),
      remove: vi.fn(),
    },
    on: (_name: string, listener: typeof click) => { click = listener; return { remove: vi.fn() }; },
  };
  const onChange = vi.fn();
  const onError = vi.fn();
  const binding = bindHexSelection({ view } as unknown as ArcgisMap, layer as unknown as FeatureLayer, onChange, onError);
  const event = { x: 10, y: 20, stopPropagation: vi.fn() };
  return { view, layer, graphic, binding, event, onChange, onError, styles, click: () => click(event) };
}

describe("geodemographic hex selection popups", () => {
  it("uses violet rather than the veteran layer's orange tones", () => {
    const { binding, styles } = fixture();
    expect(styles[0].color?.toHex()).toBe("#7250ad");
    binding.dispose();
  });

  it("disables view-wide popups and closes an open popup, then restores the previous settings", () => {
    const { binding, view, layer } = fixture();
    binding.setEnabled(true);
    expect(view.popupEnabled).toBe(false);
    expect(layer.popupEnabled).toBe(false);
    expect(view.closePopup).toHaveBeenCalledTimes(1);
    binding.setEnabled(true);
    binding.setEnabled(false);
    expect(view.popupEnabled).toBe(true);
    expect(layer.popupEnabled).toBe(true);
    binding.dispose();
  });
  it("keeps popups disabled when they were disabled before selection", () => {
    const { binding, view, layer } = fixture(false);
    binding.setEnabled(true);
    binding.dispose();
    expect(view.popupEnabled).toBe(false);
    expect(layer.popupEnabled).toBe(true);
  });
  it("consumes selection clicks while still toggling geodemographic hexes", async () => {
    const { binding, view, event, onChange, graphic, click, onError } = fixture();
    binding.setEnabled(true);
    await click();
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    expect(view.popupEnabled).toBe(false);
    expect(view.closePopup).toHaveBeenCalledTimes(2);
    expect(onChange).toHaveBeenLastCalledWith([graphic]);
    await click();
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(onError).not.toHaveBeenCalled();
    binding.dispose();
  });
  it("does not consume normal exploration clicks", async () => {
    const { binding, event, view, click } = fixture();
    await click();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(view.hitTest).not.toHaveBeenCalled();
    expect(view.popupEnabled).toBe(true);
    binding.dispose();
  });
  it("does not apply a pending selection after leaving selection mode", async () => {
    const { binding, view, onChange, graphic, click } = fixture();
    let release!: (value: unknown) => void;
    view.hitTest.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    binding.setEnabled(true);
    const pending = click();
    binding.setEnabled(false);
    release({ results: [{ type: "graphic", graphic }] });
    await pending;
    expect(binding.getSelection()).toEqual([]);
    expect(onChange).not.toHaveBeenCalled();
    expect(view.popupEnabled).toBe(true);
    binding.dispose();
  });
});
