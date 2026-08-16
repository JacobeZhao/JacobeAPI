import { expect, test } from "./extension.fixture";

test("loads the packaged side panel and filters local starter data", async ({ extensionContext, extensionId }) => {
  const panel = await extensionContext.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);

  await expect(panel.getByText("JacobeAPI", { exact: true })).toBeVisible();
  await expect(panel.getByText("引导式多代理开发")).toBeVisible();
  await expect(panel.getByRole("button", { name: "打开桌面" })).toHaveCount(1);

  await panel.getByPlaceholder("搜索名称、内容或标签").fill("技术债");
  await expect(panel.getByText("持续技术债清理")).toBeVisible();
  await expect(panel.getByText("引导式多代理开发")).toBeHidden();

  await panel.getByRole("tab", { name: /MCP/ }).click();
  await expect(panel.getByRole("heading", { name: "Filesystem" })).toBeVisible();
});
