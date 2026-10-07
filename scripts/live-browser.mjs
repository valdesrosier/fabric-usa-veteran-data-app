import { chromium } from "@playwright/test";
import { mkdir, writeFile, unlink } from "node:fs/promises";

await mkdir("test-results", { recursive: true });
const server = await chromium.launchServer({ headless: false });
await writeFile("test-results/live-browser.json", JSON.stringify({ endpoint: server.wsEndpoint() }));
const browser = await chromium.connect(server.wsEndpoint());
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: null,
});
const page = await context.newPage();
await page.goto("https://localhost:5173/");
await page.getByRole("button", { name: "Sign in with ArcGIS" }).waitFor({ timeout: 60_000 });
console.log("BROWSER_READY: Sign in in the opened Chromium window. Credentials are not recorded.");
const stop = async () => {
  await server.close();
  await unlink("test-results/live-browser.json").catch(() => {});
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setTimeout(stop, 30 * 60 * 1000);
await new Promise(() => {});
