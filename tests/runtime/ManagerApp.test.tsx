import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManagerApp } from "../../src/apps/ManagerApp";
import { createDefaultLibraryState } from "../../src/domain/defaults";
import type { AccountSessionView } from "../../src/domain/account";
import type { LibraryState } from "../../src/domain/types";
import type { PlatformServices } from "../../src/platform/contracts";
import { PlatformProvider } from "../../src/platform/PlatformProvider";
import { serializeLibraryExport } from "../../src/services/importExport";

function desktopPlatform(state: LibraryState, initialSession: AccountSessionView = { status: "signedOut", source: "mock" }) {
  let sessionListener: ((session: AccountSessionView) => void) | undefined;
  const platform: PlatformServices = {
    kind: "desktop",
    library: {
      getLibrary: vi.fn(async () => state),
      mutateLibrary: vi.fn(async () => state),
      subscribeLibrary: vi.fn(() => () => undefined),
      openManager: vi.fn(),
    },
    account: {
      getSession: vi.fn(async () => initialSession),
      login: vi.fn(),
      logout: vi.fn(),
      getSummary: vi.fn(),
      getLeaderboard: vi.fn(),
      subscribeSession: vi.fn((listener) => { sessionListener = listener; return () => undefined; }),
      subscribeSummary: vi.fn(() => () => undefined),
      subscribeLeaderboard: vi.fn(() => () => undefined),
    },
    copyText: vi.fn(),
    pickJsonFile: vi.fn(),
    saveTextFile: vi.fn(),
  };
  return { platform, emitSession: (session: AccountSessionView) => act(() => sessionListener?.(session)) };
}

function renderManager(platform: PlatformServices) {
  return render(<PlatformProvider services={platform}><ManagerApp /></PlatformProvider>);
}

describe("ManagerApp desktop home and guest access", () => {
  afterEach(cleanup);

  it("opens on Home and updates private sidebar state from the shared session subscription", async () => {
    const state = createDefaultLibraryState();
    const { platform, emitSession } = desktopPlatform(state);
    renderManager(platform);

    expect(await screen.findByRole("heading", { name: "你的 AI 工具资料库" })).toBeInTheDocument();
    expect(screen.getByLabelText("2 / 3")).toBeInTheDocument();
    expect(screen.getByLabelText("3 / 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录或注册" })).toBeInTheDocument();

    emitSession({ status: "signedIn", source: "mock", user: { id: "private-user-id", displayName: "小雅" } });
    expect(await screen.findAllByText("小雅")).toHaveLength(2);
    expect(screen.getByText("模拟账户 · 已登录", { selector: ".sidebar-user span" })).toBeInTheDocument();
    expect(screen.queryByText("private-user-id")).not.toBeInTheDocument();
  });

  it("keeps the editor closed and shows a keyboard dialog at the guest limit", async () => {
    const user = userEvent.setup();
    const state = createDefaultLibraryState();
    state.skills.push({ ...state.skills[0], id: "99999999-9999-4999-8999-999999999999", title: "Third Skill" });
    const { platform } = desktopPlatform(state);
    renderManager(platform);

    await user.click(await screen.findByRole("button", { name: "Skills" }));
    await user.click(screen.getByRole("button", { name: "新建 Skill" }));
    const dialog = await screen.findByRole("dialog", { name: "登录后继续添加" });
    expect(dialog).toHaveTextContent("最多保存 3 个 Skill");
    expect(screen.queryByRole("dialog", { name: /新建 Skill/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "登录或注册" })).toHaveFocus();
  });

  it("leaves account-less Chrome behavior on the Skills page without guest limits", async () => {
    const user = userEvent.setup();
    const state = createDefaultLibraryState();
    state.skills.push({ ...state.skills[0], id: "99999999-9999-4999-8999-999999999999", title: "Third Skill" });
    const { platform } = desktopPlatform(state);
    platform.kind = "extension";
    delete platform.account;
    renderManager(platform);

    expect(await screen.findByRole("heading", { name: "我的 Skills" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "新建 Skill" }));
    expect(await screen.findByRole("dialog", { name: "新建 Skill" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "登录后继续添加" })).not.toBeInTheDocument();
  });

  it("keeps an over-limit import preview open and guides the guest to sign in", async () => {
    const user = userEvent.setup();
    const current = createDefaultLibraryState();
    const incoming = structuredClone(current);
    incoming.mcps.push({
      ...incoming.mcps[0],
      id: "88888888-8888-4888-8888-888888888888",
      title: "Fourth MCP",
    });
    const { platform } = desktopPlatform(current);
    platform.pickJsonFile = vi.fn(async () => ({ name: "backup.json", text: serializeLibraryExport(incoming, "test") }));
    renderManager(platform);

    await user.click(await screen.findByRole("button", { name: "数据与备份" }));
    await user.click(screen.getByRole("button", { name: /选择 JSON 文件/ }));
    await user.click(await screen.findByRole("button", { name: "确认导入" }));

    expect(await screen.findByRole("dialog", { name: "登录后继续导入" })).toHaveTextContent("4 个 MCP");
    expect(screen.getByText("backup.json")).toBeInTheDocument();
    expect(platform.library.mutateLibrary).not.toHaveBeenCalledWith(expect.objectContaining({ type: "import-state" }), expect.anything());
  });

  it("preserves editor input when the backend rejects a raced guest addition", async () => {
    const user = userEvent.setup();
    const current = createDefaultLibraryState();
    const { platform } = desktopPlatform(current);
    platform.library.mutateLibrary = vi.fn().mockRejectedValue({ code: "LIMIT_EXCEEDED", message: "访客额度已用完" });
    renderManager(platform);

    await user.click(await screen.findByRole("button", { name: "Skills" }));
    await user.click(screen.getByRole("button", { name: "新建 Skill" }));
    await user.type(screen.getByRole("textbox", { name: /^Skill 名称/ }), "尚未保存的内容");
    await user.type(screen.getByRole("textbox", { name: /^提示词/ }), "请保留这些输入");
    await user.click(screen.getByRole("button", { name: "创建" }));

    expect(await screen.findByRole("dialog", { name: "登录后继续" })).toHaveTextContent("访客额度已用完");
    expect(screen.getByRole("dialog", { name: "新建 Skill" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("尚未保存的内容")).toBeInTheDocument();
  });
});
