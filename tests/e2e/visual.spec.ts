import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import sharp from "sharp";
import { expect, test } from "./extension.fixture";

const artifacts = resolve(process.env.JACOBE_E2E_ARTIFACTS ?? "artifacts");

async function capture(page: Page, name: string, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await expect.poll(() => page.evaluate(() => document.fonts.status)).toBe("loaded");
  const horizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(horizontalOverflow).toBeLessThanOrEqual(1);
  const buffer = await page.screenshot({ path: resolve(artifacts, `${name}-${width}x${height}.png`), fullPage: true });
  const stats = await sharp(buffer).stats();
  expect(Math.max(...stats.channels.slice(0, 3).map((channel) => channel.stdev))).toBeGreaterThan(8);
}

test.beforeAll(async () => {
  await mkdir(artifacts, { recursive: true });
});

test("manager is nonblank, accessible and stable across desktop widths", async ({ extensionContext, extensionId }) => {
  const page = await extensionContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);
  await expect(page.getByRole("heading", { name: "我的 Skills" })).toBeVisible();

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""))).toEqual([]);

  await capture(page, "manager", 1440, 900);
  await capture(page, "manager", 1024, 768);
  await capture(page, "manager", 960, 640);
});

test("side panel is nonblank, accessible and stable at narrow widths", async ({ extensionContext, extensionId }) => {
  const page = await extensionContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.getByText("引导式多代理开发")).toBeVisible();
  await expect(page.getByRole("button", { name: "打开桌面" })).toHaveCount(1);

  const accessibility = await new AxeBuilder({ page }).analyze();
  expect(accessibility.violations.filter((violation) => ["critical", "serious"].includes(violation.impact ?? ""))).toEqual([]);

  await capture(page, "sidepanel", 480, 900);
  await capture(page, "sidepanel", 420, 700);
  await capture(page, "sidepanel", 420, 600);
  await capture(page, "sidepanel", 360, 800);
  await capture(page, "sidepanel", 320, 720);
});
