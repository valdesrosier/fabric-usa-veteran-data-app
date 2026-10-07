import { describe, expect, it } from "vitest";
import {
  catalogQuery,
  cosineSimilarity,
  embeddingVector,
  meanVector,
  resolveBookmark,
  uniqueObjectIds,
  validateItemId,
  validateThreshold,
} from "./helpers";

const vector = (first = 1) => [first, ...new Array<number>(255).fill(0)];
const attributes = () => Object.fromEntries(vector().map((value, i) => [`emb_${i}`, value]));

describe("scoped catalog queries", () => {
  it("keeps injected portal syntax inside quoted search terms", () => {
    const query = catalogQuery("organization", 'housing" OR orgid:other -(owner:admin)', "myOrg12");
    expect(query).toContain('(orgid:"myOrg12") AND');
    expect(query).not.toContain("orgid:other");
    expect(query).toContain('"OR" AND "orgid" AND "other"');
  });
  it("always scopes Living Atlas and requires an organization account", () => {
    expect(catalogQuery("livingAtlas", "", "myOrg")).toContain("groupdesignations:livingatlas");
    expect(() => catalogQuery("organization", "", "")).toThrow();
    expect(() => catalogQuery("organization", "", 'a" OR b')).toThrow();
    expect(() => catalogQuery("organization", "a".repeat(201), "org")).toThrow();
  });
  it("validates explicit ids", () => {
    expect(validateItemId("A".repeat(32))).toBe("a".repeat(32));
    expect(() => validateItemId("item-123")).toThrow();
  });
});

describe("embedding comparisons", () => {
  it("returns bounded cosine values including antipodal vectors", () => {
    expect(cosineSimilarity(vector(), vector())).toBe(1);
    expect(cosineSimilarity(vector(), vector(-1))).toBe(-1);
    const orthogonal = vector(0);
    orthogonal[1] = 1;
    expect(cosineSimilarity(vector(), orthogonal)).toBe(0);
  });
  it("requires all 256 real finite values and a nonzero norm", () => {
    expect(embeddingVector(attributes())).toEqual(vector());
    expect(() => embeddingVector(null)).toThrow();
    expect(() => embeddingVector({ ...attributes(), emb_255: null })).toThrow();
    expect(() => embeddingVector({ ...attributes(), emb_2: Infinity })).toThrow();
    expect(() => embeddingVector({ ...attributes(), emb_2: "1" })).toThrow();
    expect(() => cosineSimilarity([1], vector())).toThrow();
    expect(() => cosineSimilarity(vector(0), vector())).toThrow();
  });
  it("compares against the mean and rejects an empty or cancelling mean", () => {
    expect(meanVector([vector(1), vector(3)])).toEqual(vector(2));
    expect(() => meanVector([])).toThrow();
    expect(() => meanVector([vector(), vector(-1)])).toThrow();
  });
  it("validates thresholds without silently clamping them", () => {
    expect(validateThreshold(0.8)).toBe(0.8);
    for (const value of [-0.1, 1.1, NaN, Infinity]) {
      expect(() => validateThreshold(value)).toThrow();
    }
  });
});

describe("selection and bookmark identifiers", () => {
  it("deduplicates numeric/string ids while rejecting missing ids", () => {
    expect(uniqueObjectIds([1, "1", 2, 2])).toEqual(["1", 2]);
    expect(() => uniqueObjectIds([undefined])).toThrow();
    expect(() => uniqueObjectIds([NaN])).toThrow();
    expect(() => uniqueObjectIds([" "])).toThrow();
  });
  it("resolves exact and unique substring bookmarks and reports ambiguity", () => {
    const bookmarks = [{ name: "Texas" }, { name: "East Texas" }, { name: "Ohio" }];
    expect(resolveBookmark(bookmarks, "texas").name).toBe("Texas");
    expect(resolveBookmark(bookmarks, "east").name).toBe("East Texas");
    expect(() => resolveBookmark(bookmarks, "as")).toThrow("ambiguous");
    expect(() => resolveBookmark([], "Texas")).toThrow("no bookmarks");
    expect(() => resolveBookmark(bookmarks, "Iowa")).toThrow("No bookmark");
  });
});
