import { describe, expect, it, vi } from "vitest";

vi.mock("@arcgis/core/PopupTemplate.js", () => ({
  default: class { constructor(properties: object) { Object.assign(this, properties); } },
}));

import { createVeteranPopupTemplate, formatVeteranCount } from "./veteran-popup";

describe("veteran popup", () => {
  it("formats actual counts and preserves zero", () => {
    expect(formatVeteranCount(12345)).toBe("12,345");
    expect(formatVeteranCount(0)).toBe("0");
    expect(formatVeteranCount("9007199254740993")).toBe("9,007,199,254,740,993");
  });

  it("shows missing, unsafe, or invalid Count values as unavailable", () => {
    for (const value of [null, undefined, NaN, Infinity, -1, 1.5, "", "<img src=x>", Number.MAX_SAFE_INTEGER + 1]) {
      expect(formatVeteranCount(value)).toBe("Unavailable");
    }
  });

  it("requests the popup fields and replaces the raw attribute table", () => {
    const popup = createVeteranPopupTemplate();
    expect(popup.title).toBe("Veteran procedures");
    expect(popup.outFields).toEqual(["COUNT", "DESCRIPTION", "BIN_ID"]);
    expect(popup.content).toBeTypeOf("function");
    expect(popup.lastEditInfoEnabled).toBe(false);
  });
});
