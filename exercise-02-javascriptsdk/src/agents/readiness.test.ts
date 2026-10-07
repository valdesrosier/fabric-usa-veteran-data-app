import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForAssistantReady } from "./readiness";

afterEach(() => vi.useRealTimers());

describe("orchestrator readiness", () => {
  it("does not confuse connected components or registered agents with a ready orchestrator", async () => {
    const element = new EventTarget();
    const resolved = vi.fn();
    const result = waitForAssistantReady(element).then(resolved);
    element.dispatchEvent(new Event("connected"));
    element.dispatchEvent(new Event("agentsRegistered"));
    await Promise.resolve();
    expect(resolved).not.toHaveBeenCalled();
    element.dispatchEvent(new Event("arcgisReady"));
    await result;
    expect(resolved).toHaveBeenCalledOnce();
  });

  it("rejects the live registry mismatch and does not recommend automatic regeneration", async () => {
    const element = new EventTarget();
    const result = waitForAssistantReady(element);
    element.dispatchEvent(new CustomEvent("arcgisError", {
      detail: new Error("Layer count mismatch during registry restoration. Regenerate embeddings."),
    }));
    await expect(result).rejects.toThrow("before adding session-only FeatureLayers");
  });

  it("does not hang forever when the SDK never initializes", async () => {
    vi.useFakeTimers();
    const result = waitForAssistantReady(new EventTarget(), undefined, 100);
    const assertion = expect(result).rejects.toThrow("orchestrator is not ready");
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it("cancels pending initialization during cleanup", async () => {
    const abort = new AbortController();
    const result = waitForAssistantReady(new EventTarget(), abort.signal);
    abort.abort();
    await expect(result).rejects.toThrow("cancelled");
  });
});
