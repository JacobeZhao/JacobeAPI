import { test as base, chromium, type BrowserContext } from "@playwright/test";
import { resolve } from "node:path";

interface ExtensionFixtures {
  extensionContext: BrowserContext;
  extensionId: string;
}

export const test = base.extend<ExtensionFixtures>({
  extensionContext: async ({}, run, testInfo) => {
    const extensionPath = process.env.JACOBE_EXTENSION_DIST
      ? resolve(process.env.JACOBE_EXTENSION_DIST)
      : decodeURIComponent(new URL("../../dist", import.meta.url).pathname)
          .replace(/^\/([a-z]:\/)/i, "$1");
    const context = await chromium.launchPersistentContext(testInfo.outputPath("chrome-profile"), {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
      ],
    });
    await run(context);
    await context.close();
  },
  extensionId: async ({ extensionContext }, run) => {
    let [worker] = extensionContext.serviceWorkers();
    worker ??= await extensionContext.waitForEvent("serviceworker");
    await run(new URL(worker.url()).host);
  },
});

export { expect } from "@playwright/test";
