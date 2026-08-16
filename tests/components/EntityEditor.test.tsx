import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntityEditor } from "../../src/features/library/EntityEditor";

afterEach(cleanup);

describe("EntityEditor", () => {
  it("explains missing required Skill fields and keeps the form open", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EntityEditor kind="skill" onCancel={vi.fn()} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "创建" }));

    expect(screen.getByText("请输入名称")).toBeInTheDocument();
    expect(screen.getByText("请输入提示词")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("builds structured MCP args and env values", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EntityEditor kind="mcp" onCancel={vi.fn()} onSave={onSave} />);

    await user.type(screen.getByLabelText(/工具名称/), "本地文件");
    await user.type(screen.getByLabelText(/服务器名称/), "filesystem");
    await user.type(screen.getByLabelText(/启动命令/), "npx");
    await user.type(screen.getByLabelText(/^命令参数/), "-y\nserver-filesystem");
    await user.type(screen.getByLabelText(/^环境变量/), "MODE=read-only\nDEBUG=1");
    await user.click(screen.getByRole("button", { name: "创建" }));

    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      kind: "mcp",
      title: "本地文件",
      serverName: "filesystem",
      command: "npx",
      args: ["-y", "server-filesystem"],
      env: { MODE: "read-only", DEBUG: "1" },
    }));
  });

  it("rejects an invalid environment variable line", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(<EntityEditor kind="mcp" onCancel={vi.fn()} onSave={onSave} />);

    await user.type(screen.getByLabelText(/工具名称/), "测试工具");
    await user.type(screen.getByLabelText(/服务器名称/), "test");
    await user.type(screen.getByLabelText(/启动命令/), "node");
    await user.type(screen.getByLabelText(/^环境变量/), "没有等号");
    await user.click(screen.getByRole("button", { name: "创建" }));

    expect(screen.getByText(/应写成 KEY=VALUE/)).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
