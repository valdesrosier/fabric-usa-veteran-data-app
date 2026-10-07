import "@arcgis/ai-components/components/arcgis-assistant";
import "@arcgis/ai-components/components/arcgis-assistant-agent";
import "@arcgis/ai-components/components/arcgis-assistant-navigation-agent";
import "@arcgis/ai-components/components/arcgis-assistant-data-exploration-agent";
import "@arcgis/ai-components/components/arcgis-assistant-help-agent";
import type { AppContext } from "../types";
import { createAssistantController, type AssistantController } from "./controller";
import { createCustomAgents } from "./custom-agents";
import { waitForAssistantReady } from "./readiness";

export { AssistantController, createAssistantController } from "./controller";
export { LayerCatalog } from "./catalog";
export { queryFeaturesByIds } from "./queries";
export { waitForAssistantReady } from "./readiness";
export * from "./helpers";

const mounts = new WeakMap<HTMLElement, () => void>();
const controllers = new WeakMap<HTMLElement, AssistantController>();
const controllerKey = Symbol.for("veteran-atlas.assistant-controller");
const componentNames = [
  "arcgis-assistant",
  "arcgis-assistant-agent",
  "arcgis-assistant-navigation-agent",
  "arcgis-assistant-data-exploration-agent",
  "arcgis-assistant-help-agent",
] as const;

/** Returns only the real mounted, authenticated controller; never fabricates context. */
export function getAssistantController(element: HTMLElement): AssistantController | null {
  // Vite HMR URLs can instantiate this module more than once. The element-owned
  // binding keeps direct browser imports attached to the actual mounted instance.
  return controllers.get(element) ?? Reflect.get(element, controllerKey) ?? null;
}

/**
 * Mount once per native assistant. The parent owns the assistant and must set
 * referenceElement to its arcgis-map component (SDK 5.1 does not accept MapView).
 * Prefer passing a host while the assistant is still disconnected. An already
 * connected assistant is replaced because its queued SDK load cannot be cancelled.
 */
export async function mountAssistant(
  element: HTMLElement,
  ctx: AppContext,
  hostElement?: HTMLElement,
): Promise<() => void> {
  if (element.localName !== "arcgis-assistant") {
    throw new Error("mountAssistant requires a native arcgis-assistant element.");
  }
  const host = hostElement ?? element.parentNode;
  const nextSibling = element.nextSibling;
  if (!host?.isConnected) {
    throw new Error("Pass a connected assistant host, or append the assistant to its host before mounting.");
  }
  const wasConnected = element.isConnected;
  element.remove();
  mounts.get(element)?.();
  const original = element;
  if (wasConnected) {
    const previous = element as HTMLArcgisAssistantElement;
    const fresh = document.createElement("arcgis-assistant");
    for (const attribute of Array.from(previous.attributes)) {
      fresh.setAttribute(attribute.name, attribute.value);
    }
    for (const property of [
      "referenceElement", "heading", "description", "entryMessage", "suggestedPrompts",
      "assistantAvatarEnabled", "copyEnabled", "feedbackEnabled", "keepSuggestedPrompts",
      "logEnabled", "streamingDisabled",
    ] as const) {
      Object.assign(fresh, { [property]: previous[property] });
    }
    element = fresh;
  }
  const controller = createAssistantController(ctx);
  const initialization = new AbortController();
  const children: HTMLElement[] = [];
  let custom: Awaited<ReturnType<typeof createCustomAgents>> | null = null;
  let cancelled = false;
  const cleanup = () => {
    if (cancelled) return;
    cancelled = true;
    initialization.abort();
    element.remove();
    controller.dispose();
    // SDK disconnectedCallback unregisters both built-in and custom agents.
    for (const child of children.splice(0)) child.remove();
    custom?.dispose();
    if (mounts.get(element) === cleanup) {
      mounts.delete(element);
      controllers.delete(element);
      Reflect.deleteProperty(element, controllerKey);
    }
    if (mounts.get(original) === cleanup) {
      mounts.delete(original);
      controllers.delete(original);
      Reflect.deleteProperty(original, controllerKey);
    }
  };
  mounts.set(element, cleanup);
  mounts.set(original, cleanup);
  try {
    await Promise.all(componentNames.map((name) => customElements.whenDefined(name)));
    if (cancelled) return cleanup;
    const assistant = element as HTMLArcgisAssistantElement;
    const reference = assistant.referenceElement;
    const map = typeof reference === "string" ? document.getElementById(reference) : reference;
    if (!map || map.localName !== "arcgis-map" || !("view" in map) || map.view !== ctx.view) {
      throw new Error("SDK 5.1 assistant.referenceElement must be the matching arcgis-map component (or its id), not a MapView.");
    }
    custom = await createCustomAgents(controller);
    if (cancelled) {
      custom.dispose();
      return cleanup;
    }
    if (!host.isConnected) {
      cleanup();
      return cleanup;
    }
    assistant.heading ??= "Veteran map assistant";
    assistant.description ??= "Explore this map, discover layers, and compare county context.";
    assistant.entryMessage ??= "Ask about this map or search organization and Living Atlas layers. Select small USA geodemographic hexes for similarity comparison. Demographics describe ACS county context, not individual hexagons. AI requires a named organization account with beta and AI privileges enabled.";
    if (!assistant.suggestedPrompts?.length) {
      assistant.suggestedPrompts = [
        "Find Living Atlas layers about veterans",
        "List this map's bookmarks",
        "Explain the selected hexagons' county demographics",
      ];
    }
    for (const name of [
      "arcgis-assistant-navigation-agent",
      "arcgis-assistant-data-exploration-agent",
      "arcgis-assistant-help-agent",
    ] as const) {
      const child = document.createElement(name);
      child.referenceElement = reference ?? undefined;
      children.push(child);
      assistant.appendChild(child);
    }
    for (const agent of custom.agents) {
      const child = document.createElement("arcgis-assistant-agent");
      child.agent = agent.registration;
      children.push(child);
      assistant.appendChild(child);
    }
    const ready = waitForAssistantReady(assistant, initialization.signal);
    host.insertBefore(assistant, nextSibling?.parentNode === host ? nextSibling : null);
    await ready;
    if (cancelled) return cleanup;
    controllers.set(element, controller);
    controllers.set(original, controller);
    Object.defineProperty(element, controllerKey, { value: controller, configurable: true });
    Object.defineProperty(original, controllerKey, { value: controller, configurable: true });
    return cleanup;
  } catch (error) {
    cleanup();
    throw error;
  }
}
