import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SidePanelApp } from "../../src/apps/SidePanelApp";
import { extensionPlatform } from "../../src/platform/extensionPlatform";
import { PlatformProvider } from "../../src/platform/PlatformProvider";

function renderSidePanel() {
  return render(
    <PlatformProvider services={extensionPlatform}>
      <SidePanelApp />
    </PlatformProvider>,
  );
}

describe("SidePanelApp", () => {
  afterEach(cleanup);

  beforeEach(() => {
    localStorage.clear();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    });
  });

  it("searches skills and copies the complete prompt", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    renderSidePanel();

    expect(await screen.findByText("引导式多代理开发")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("搜索名称、内容或标签"), "技术债");
    expect(screen.queryByText("引导式多代理开发")).not.toBeInTheDocument();
    expect(screen.getByText("持续技术债清理")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "复制提示词" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledOnce());
    expect(screen.getByText("完整提示词已复制")).toBeInTheDocument();
  });

  it("switches to MCP and combines tag filters with OR semantics", async () => {
    const user = userEvent.setup();
    renderSidePanel();

    await screen.findByText("引导式多代理开发");
    await user.click(screen.getByRole("tab", { name: /MCP/ }));
    expect(screen.getByText("Filesystem")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "文件" }));
    expect(screen.getByText("Filesystem")).toBeInTheDocument();
  });

  it("has one desktop entry in the header and no account footer in the extension", async () => {
    renderSidePanel();

    await screen.findByRole("tab", { name: /Skills/ });
    expect(screen.getAllByRole("button", { name: "打开桌面" })).toHaveLength(1);
    expect(screen.queryByText("管理全部内容")).not.toBeInTheDocument();
    expect(screen.queryByText(/个结果/)).not.toBeInTheDocument();
    expect(screen.queryByRole("contentinfo", { name: "账户摘要" })).not.toBeInTheDocument();
  });
});
