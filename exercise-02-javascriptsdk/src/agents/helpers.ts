export const EMBEDDING_DIMENSIONS = 256;
export const EMBEDDING_FIELDS = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => `emb_${index}`);
export const MAPPABLE_ITEM_TYPES = [
  "Feature Service",
  "Map Service",
  "Image Service",
  "Vector Tile Service",
] as const;

export type CatalogScope = "organization" | "livingAtlas";
export type ObjectId = number | string;

export function validateItemId(value: string): string {
  const id = value.trim();
  if (!/^[a-f0-9]{32}$/i.test(id)) {
    throw new Error("An ArcGIS item id must contain exactly 32 hexadecimal characters.");
  }
  return id.toLowerCase();
}

export function catalogQuery(scope: CatalogScope, text: string, orgId: string): string {
  if (scope !== "organization" && scope !== "livingAtlas") {
    throw new Error("Choose the organization or Living Atlas catalog.");
  }
  if (!/^[a-z0-9]{1,64}$/i.test(orgId)) {
    throw new Error("A signed-in organization account is required.");
  }
  if (text.length > 200) throw new Error("Use search text of at most 200 characters.");
  const terms = text.match(/[\p{L}\p{N}_]+/gu) ?? [];
  const scopeQuery =
    scope === "organization" ? `orgid:"${orgId}"` : "groupdesignations:livingatlas";
  const types = MAPPABLE_ITEM_TYPES.map((type) => `type:"${type}"`).join(" OR ");
  const keywords = terms.map((term) => `"${term}"`).join(" AND ");
  return `(${scopeQuery}) AND (${types})${keywords ? ` AND (${keywords})` : ""}`;
}

export function uniqueObjectIds(values: unknown[]): ObjectId[] {
  const ids = new Map<string, ObjectId>();
  for (const value of values) {
    if (
      (typeof value !== "number" && typeof value !== "string") ||
      (typeof value === "number" && (!Number.isSafeInteger(value) || value < 0)) ||
      (typeof value === "string" && !value.trim())
    ) {
      throw new Error("Every selected feature must have a valid object id.");
    }
    const id = typeof value === "string" ? value.trim() : value;
    ids.set(String(id), id);
  }
  return [...ids.values()];
}

export function embeddingVector(attributes: Record<string, unknown> | null | undefined): number[] {
  if (!attributes) throw new Error("Embedding attributes are missing.");
  const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, (_, index) => {
    const value = attributes[`emb_${index}`];
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Embedding field emb_${index} is missing, null, or not finite.`);
    }
    return value;
  });
  validateVector(vector);
  return vector;
}

function validateVector(vector: readonly number[]): void {
  if (
    vector.length !== EMBEDDING_DIMENSIONS ||
    vector.some((value) => !Number.isFinite(value))
  ) {
    throw new Error("An embedding must have exactly 256 finite numeric dimensions.");
  }
  const norm = Math.hypot(...vector);
  if (!Number.isFinite(norm) || norm === 0) {
    throw new Error("A zero-norm or numerically overflowing embedding cannot be compared.");
  }
}

export function meanVector(vectors: readonly (readonly number[])[]): number[] {
  if (!vectors.length) throw new Error("Select at least one embedding hexagon first.");
  const mean = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  for (const vector of vectors) {
    validateVector(vector);
    for (let index = 0; index < EMBEDDING_DIMENSIONS; index++) {
      mean[index] += vector[index] / vectors.length;
    }
  }
  validateVector(mean);
  return mean;
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  validateVector(left);
  validateVector(right);
  const leftNorm = Math.hypot(...left);
  const rightNorm = Math.hypot(...right);
  const score = left.reduce(
    (sum, value, index) => sum + (value / leftNorm) * (right[index] / rightNorm),
    0,
  );
  return Math.max(-1, Math.min(1, score));
}

export function validateThreshold(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error("The cosine-similarity threshold must be between 0 and 1.");
  }
  return value;
}

export function resolveBookmark<T extends { name: string }>(
  bookmarks: readonly T[],
  requestedName: string,
): T {
  if (!bookmarks.length) throw new Error("This web map has no bookmarks.");
  const name = requestedName.trim().toLocaleLowerCase();
  if (!name) throw new Error("Provide a bookmark name.");
  const exact = bookmarks.filter((bookmark) => bookmark.name.toLocaleLowerCase() === name);
  const matches = exact.length
    ? exact
    : bookmarks.filter((bookmark) => bookmark.name.toLocaleLowerCase().includes(name));
  if (!matches.length) {
    throw new Error(`No bookmark matches "${requestedName}". Available: ${bookmarks.map((b) => b.name).join(", ")}.`);
  }
  if (matches.length > 1) {
    throw new Error(`Bookmark name is ambiguous. Choose one of: ${matches.map((b) => b.name).join(", ")}.`);
  }
  return matches[0];
}
