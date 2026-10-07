import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";

const endpoint = process.env.PLAYWRIGHT_WS_ENDPOINT
  ?? JSON.parse(await readFile(".vite/live-browser.json", "utf8").catch(
    () => readFile("test-results/live-browser.json", "utf8"),
  )).endpoint;
const browser = await chromium.connect(endpoint);
const cdp = await browser.newBrowserCDPSession();
const { targetInfos } = await cdp.send("Target.getTargets");
const target = targetInfos.find((item) => item.type === "page" && item.url.startsWith("https://localhost:5173"));
if (!target) throw new Error("Live application page not found.");
const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: false });
if (process.argv.includes("--reload")) {
  await cdp.send("Target.sendMessageToTarget", {
    sessionId,
    message: JSON.stringify({ id: 0, method: "Page.reload", params: { ignoreCache: true } }),
  });
  await new Promise((resolve) => setTimeout(resolve, 5_000));
}
const prompt = process.argv.includes("--help-prompt")
  ? "What can you help me do with this map?"
  : "List this map's bookmarks";
const response = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Live assistant check timed out.")), 90_000);
  cdp.on("Target.receivedMessageFromTarget", (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (message.id !== 1) return;
    clearTimeout(timeout);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
});
await cdp.send("Target.sendMessageToTarget", {
  sessionId,
  message: JSON.stringify({
    id: 1,
    method: "Runtime.evaluate",
    params: {
      awaitPromise: true,
      returnByValue: true,
      expression: `(async () => {
        const { getAssistantController } = await import("/src/agents/index.ts");
        let assistant;
        const started = Date.now();
        while (Date.now() - started < 60_000) {
          assistant = document.querySelector("arcgis-assistant");
          if (assistant && getAssistantController(assistant)) break;
          const errors = document.body.innerText.split("\\n").filter(line => /initialization failed|No agents found|could not initialize/i.test(line));
          if (errors.length) return { ok: false, errors };
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        if (!assistant) return { ok: false, error: "Assistant absent" };
        if (!getAssistantController(assistant)) return { ok: false, error: "Mounted controller never became ready." };
        try {
          await assistant.submitMessage(${JSON.stringify(prompt)});
          const last = assistant.messages.at(-1);
          return {
            ok: last?.role === "assistant" && !last.error && !last.isStreaming,
            agentChildCount: assistant.children.length,
            messageCount: assistant.messages.length,
            response: last?.role === "assistant" ? last.content : null,
            error: last?.error?.message ?? (last?.role !== "assistant" ? "No assistant response; submission alone is not readiness." : null)
          };
        } catch (error) {
          return { ok: false, error: error.message };
        }
      })()`,
    },
  }),
});
const result = await response;
const verdict = result.result?.value ?? { ok: false, error: "Live check did not return a result." };
console.log(JSON.stringify(verdict));
await cdp.send("Target.detachFromTarget", { sessionId });
process.exit(verdict.ok ? 0 : 1);
