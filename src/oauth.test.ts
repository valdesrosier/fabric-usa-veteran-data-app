import { describe, expect, it } from "vitest";
import { readOAuthCallback, withoutOAuthCallback } from "./oauth";

describe("OAuth return URL handling", () => {
  it("reads query and legacy hash callbacks before the SDK consumes them", () => {
    expect(readOAuthCallback(new URL("https://localhost:5173/?code=abc&state=x")).code).toBe("abc");
    expect(readOAuthCallback(new URL("https://localhost:5173/#error=access_denied&error_description=Not+allowed")))
      .toEqual({ code: null, error: "access_denied", description: "Not allowed" });
  });
  it("removes callback secrets but preserves normal app state", () => {
    expect(withoutOAuthCallback(new URL("https://localhost:5173/?code=abc&state=x&county=12086#map")))
      .toBe("/?county=12086#map");
    expect(withoutOAuthCallback(new URL("https://localhost:5173/#code=abc&state=x&county=12086")))
      .toBe("/#county=12086");
  });
});
