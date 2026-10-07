import { chromium } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

export async function connectLive() {
  const { endpoint } = JSON.parse(await readFile("test-results/live-browser.json", "utf8"));
  const browser = await chromium.connect(endpoint);
  const cdp = await browser.newBrowserCDPSession();
  const { targetInfos } = await cdp.send("Target.getTargets");
  const target = targetInfos.find((entry) => entry.type === "page" && entry.url.startsWith("https://localhost:5173"));
  if (!target) throw new Error("The verification browser is not on the local app.");
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId: target.targetId, flatten: false });
  let sequence = 0;
  const pending = new Map();
  cdp.on("Target.receivedMessageFromTarget", (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    const task = pending.get(message.id);
    if (!task) return;
    pending.delete(message.id);
    clearTimeout(task.timer);
    if (message.error) task.reject(new Error(message.error.message));
    else task.resolve(message.result);
  });
  const send = (method, params = {}, timeout = 120_000) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out.`));
    }, timeout);
    pending.set(id, { resolve, reject, timer });
    cdp.send("Target.sendMessageToTarget", {
      sessionId, message: JSON.stringify({ id, method, params }),
    }).catch((error) => {
      clearTimeout(timer);
      pending.delete(id);
      reject(error);
    });
  });
  return {
    send,
    async evaluate(expression, timeout = 120_000) {
      const response = await send("Runtime.evaluate", {
        expression, awaitPromise: true, returnByValue: true,
      }, timeout);
      if (response.exceptionDetails) {
        throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
      }
      return response.result.value;
    },
    async screenshot(path) {
      const { data } = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(path, Buffer.from(data, "base64"));
    },
    close: () => browser.close(),
  };
}
