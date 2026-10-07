/** Only the documented arcgisReady event confirms a usable SDK orchestrator. */
export function waitForAssistantReady(
  assistant: EventTarget,
  signal?: AbortSignal,
  timeoutMs = 60_000,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (error?: Error) => {
      clearTimeout(timer);
      assistant.removeEventListener("arcgisReady", ready);
      assistant.removeEventListener("arcgisError", failed);
      signal?.removeEventListener("abort", aborted);
      if (error) reject(error);
      else resolve();
    };
    const ready = () => finish();
    const failed = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const message = detail instanceof Error ? detail.message : String(detail ?? "Unknown initialization failure");
      const guidance = /registry restoration/.test(message)
        ? " Initialize the assistant against the original web-map layers before adding session-only FeatureLayers. No embeddings were regenerated or saved."
        : "";
      finish(new Error(`Assistant initialization failed: ${message}${guidance}`));
    };
    const aborted = () => finish(new Error("Assistant initialization was cancelled."));
    if (signal?.aborted) {
      aborted();
      return;
    }
    assistant.addEventListener("arcgisReady", ready);
    assistant.addEventListener("arcgisError", failed);
    signal?.addEventListener("abort", aborted, { once: true });
    timer = setTimeout(() => finish(new Error(
      "The assistant did not emit arcgisReady within 60 seconds. Its orchestrator is not ready; check sign-in, AI privileges, and the web-map embeddings resource.",
    )), timeoutMs);
  });
}
