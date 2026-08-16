import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Skill } from "../../src/domain/types";
import { CardGrid } from "../../src/features/library/CardGrid";

const skill: Skill = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "skill",
  title: "会议纪要助手",
  description: "把讨论整理成清晰的行动项。",
  prompt: "请提取决定、负责人和截止时间。",
  installNotes: "直接复制使用",
  tags: ["会议", "写作", "效率", "团队"],
  favorite: false,
  createdAt: "2026-08-15T12:00:00.000Z",
  updatedAt: "2026-08-15T12:00:00.000Z",
};

describe("CardGrid", () => {
  it("renders a stable preview while exposing specific actions", async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn();
    const onCopyInstall = vi.fn();
    const onDownload = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const onToggleFavorite = vi.fn();

    render(
      <CardGrid
        cards={[skill]}
        onCopy={onCopy}
        onCopyInstall={onCopyInstall}
        onDownload={onDownload}
        onEdit={onEdit}
        onDelete={onDelete}
        onToggleFavorite={onToggleFavorite}
      />,
    );

    expect(screen.getByRole("heading", { name: skill.title })).toBeInTheDocument();
    expect(screen.getByText("+1")).toHaveAttribute("title", "团队");

    await user.click(screen.getByRole("button", { name: `复制提示词 ${skill.title}` }));
    await user.click(screen.getByRole("button", { name: `复制使用说明 ${skill.title}` }));
    await user.click(screen.getByRole("button", { name: `收藏 ${skill.title}` }));
    await user.click(screen.getByRole("button", { name: `删除 ${skill.title}` }));

    expect(onCopy).toHaveBeenCalledWith(skill);
    expect(onCopyInstall).toHaveBeenCalledWith(skill);
    expect(onToggleFavorite).toHaveBeenCalledWith(skill);
    expect(onDelete).toHaveBeenCalledWith(skill);
  });
});
