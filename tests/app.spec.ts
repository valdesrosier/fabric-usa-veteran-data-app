import { test, expect } from "@playwright/test";

test("signed-out app presents a usable gate and real OAuth redirect", async ({ page }) => {
  const crashes: string[] = [];
  page.on("pageerror", (error) => crashes.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in", exact: true })).toBeVisible();
  const signIn = page.getByRole("button", { name: "Sign in with ArcGIS" });
  await expect(signIn).toBeEnabled();
  expect(crashes).toEqual([]);
  await signIn.click();
  await page.waitForURL(/arcgis\.com.*oauth2\/authorize/);
  const url = new URL(page.url());
  expect(url.searchParams.get("client_id")).toBe("62Rpl2LcPZmVawFr");
  expect(url.searchParams.get("redirect_uri")).toBe("https://localhost:5173/");
  expect(url.searchParams.get("code_challenge")).toBeTruthy();
});

test("callback errors remain visible and are removed from the URL", async ({ page }) => {
  await page.goto("/?error=access_denied&error_description=Test%20permission%20denied");
  await expect(page.getByRole("alert")).toContainText("Test permission denied");
  await expect(page.getByTestId("sign-in-gate")).toBeVisible();
  await expect(page).toHaveURL("https://localhost:5173/");
});

test("mobile sign-in stays within the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in with ArcGIS" })).toBeEnabled();
  const widths = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.content).toBeLessThanOrEqual(widths.viewport);
});
