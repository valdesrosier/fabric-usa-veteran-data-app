import Layer from "@arcgis/core/layers/Layer.js";
import GroupLayer from "@arcgis/core/layers/GroupLayer.js";
import PortalItem from "@arcgis/core/portal/PortalItem.js";
import type { AppContext } from "../types";
import { catalogQuery, MAPPABLE_ITEM_TYPES, validateItemId, type CatalogScope } from "./helpers";

export function requireOrganization(ctx: AppContext): string {
  if (!ctx.portal.user?.username) {
    throw new Error("Sign in with a named ArcGIS organization account first.");
  }
  const orgId = ctx.portal.user.orgId || ctx.portal.id;
  if (!orgId || !/^[a-z0-9]{1,64}$/i.test(orgId)) {
    throw new Error("The signed-in account is not associated with an ArcGIS organization.");
  }
  return orgId;
}

export interface CatalogCandidate {
  handle: string;
  itemId: string;
  title: string;
  owner: string;
  type: string;
}

/** Both catalog agents share the same scope validation and session-only add path. */
export class LayerCatalog {
  private candidates = new Map<string, { scope: CatalogScope; itemId: string }>();
  private pendingAdds = new Map<string, Promise<{ added: boolean; title: string; itemId: string; message: string }>>();
  private sequence = 0;

  constructor(
    private ctx: AppContext,
    private assertActive: () => void,
    private signal: AbortSignal,
  ) {}

  async search(scope: CatalogScope, text: string, start = 1, pageSize = 6) {
    this.assertActive();
    const orgId = requireOrganization(this.ctx);
    if (!Number.isInteger(start) || start < 1) throw new Error("Search start must be a positive integer.");
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
      throw new Error("Search page size must be between 1 and 50.");
    }
    const result = await this.ctx.portal.queryItems(
      { query: catalogQuery(scope, text, orgId), start, num: pageSize },
      { signal: this.signal },
    );
    this.assertActive();
    const candidates: CatalogCandidate[] = [];
    for (const item of result.results) {
      if (!item.id) continue;
      const itemId = validateItemId(item.id);
      const handle = `${scope === "organization" ? "org" : "atlas"}-${++this.sequence}`;
      this.candidates.set(handle, { scope, itemId });
      candidates.push({
        handle,
        itemId,
        title: item.title || "(untitled)",
        owner: item.owner || "(unknown owner)",
        type: item.type || "(unknown type)",
      });
    }
    const nextStart = result.nextQueryParams?.start;
    return {
      scope,
      candidates,
      total: result.total,
      start,
      nextStart: nextStart && nextStart > start ? nextStart : null,
      note: "Search results are not added automatically. Use a returned handle or an explicit item id. Request nextStart to see further results.",
    };
  }

  async add(scope: CatalogScope, handleOrItemId: string) {
    this.assertActive();
    const orgId = requireOrganization(this.ctx);
    const candidate = this.candidates.get(handleOrItemId.trim());
    if (candidate && candidate.scope !== scope) {
      throw new Error("That candidate belongs to the other catalog. Search the requested catalog first.");
    }
    const itemId = candidate?.itemId ?? validateItemId(handleOrItemId);
    const portalItem = new PortalItem({ id: itemId, portal: this.ctx.portal });
    await portalItem.load({ signal: this.signal });
    if (!(MAPPABLE_ITEM_TYPES as readonly string[]).includes(portalItem.type ?? "")) {
      throw new Error(`Unsupported item type "${portalItem.type ?? "unknown"}". This 2D app accepts Feature Service, Map Service, Image Service, and Vector Tile Service items, not Scene Service items.`);
    }
    const scoped = await this.ctx.portal.queryItems(
      { query: `${catalogQuery(scope, "", orgId)} AND id:"${itemId}"`, num: 1, start: 1 },
      { signal: this.signal },
    );
    if (!scoped.results.some((item) => item.id?.toLowerCase() === itemId)) {
      throw new Error(`Item ${itemId} could not be verified in ${scope === "organization" ? "your signed-in organization" : "Living Atlas"}. Nothing was added.`);
    }
    this.assertActive();
    const pending = this.pendingAdds.get(itemId);
    if (pending) return pending;
    const operation = this.addLoadedItem(portalItem, itemId);
    this.pendingAdds.set(itemId, operation);
    try {
      return await operation;
    } finally {
      this.pendingAdds.delete(itemId);
    }
  }

  private async addLoadedItem(portalItem: PortalItem, itemId: string) {
    const existing = this.ctx.webMap.allLayers.find(
      (layer) => "portalItem" in layer && (layer.portalItem as PortalItem | null)?.id?.toLowerCase() === itemId,
    );
    if (existing) {
      return { added: false, itemId, title: existing.title ?? portalItem.title ?? itemId, message: "This item is already on the map; no duplicate was added." };
    }
    const layer = await Layer.fromPortalItem({ portalItem });
    try {
      await layer.load({ signal: this.signal });
      if (layer instanceof GroupLayer) await layer.loadAll();
      this.assertActive();
      if (layer instanceof GroupLayer && layer.allLayers.some((child) => child.type === "scene")) {
        throw new Error("This service contains an unsupported 3D Scene layer.");
      }
      this.ctx.webMap.add(layer);
      try {
        await this.ctx.view.whenLayerView(layer);
        this.assertActive();
      } catch (error) {
        this.ctx.webMap.remove(layer);
        throw error;
      }
      return {
        added: true,
        itemId,
        title: layer.title ?? portalItem.title ?? itemId,
        message: "Added to this browser session only. The source web map was not saved or modified.",
      };
    } catch (error) {
      layer.destroy();
      throw error;
    }
  }

  clear() {
    this.candidates.clear();
    this.pendingAdds.clear();
  }
}
