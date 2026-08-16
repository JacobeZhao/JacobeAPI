import { expect, test } from "./extension.fixture";

test("creates, copies, searches and persists a Skill in the manager", async ({ extensionContext, extensionId }) => {
  const page = await extensionContext.newPage();
  await page.goto(`chrome-extension://${extensionId}/index.html`);

  await expect(page.getByRole("heading", { name: "我的 Skills" })).toBeVisible();
  await page.getByRole("button", { name: "新建 Skill" }).click();
  await page.getByLabel("Skill 名称").fill("需求澄清助手");
  await page.locator("#editor-tags").fill("产品, 新手友好");
  await page.getByLabel("简短说明").fill("把模糊想法整理成可执行需求。");
  await page.locator("#editor-prompt").fill("请先提出关键问题，再整理目标、范围和验收标准。");
  await page.locator("#editor-installNotes").fill("开始新项目之前复制使用。");
  await page.getByRole("button", { name: "创建" }).click();

  await expect(page.getByRole("heading", { name: "需求澄清助手" })).toBeVisible();
  await page.getByRole("button", { name: "复制提示词 需求澄清助手" }).click();
  await expect(page.getByText("提示词已复制")).toBeVisible();

  await page.getByPlaceholder("搜索名称、提示词或标签").fill("产品");
  await expect(page.getByRole("heading", { name: "需求澄清助手" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "代码审查清单" })).toBeHidden();

  await page.reload();
  await page.getByPlaceholder("搜索名称、提示词或标签").fill("需求澄清");
  await expect(page.getByRole("heading", { name: "需求澄清助手" })).toBeVisible();
});
