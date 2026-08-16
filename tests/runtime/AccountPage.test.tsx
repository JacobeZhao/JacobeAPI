import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountPage } from "../../src/features/account/AccountPage";
import type { AccountSessionView, AccountSummarySnapshot, LeaderboardSnapshot } from "../../src/domain/account";
import type { PlatformServices } from "../../src/platform/contracts";
import { previewPlatform } from "../../src/platform/previewPlatform";

const signedOut: AccountSessionView = { status: "signedOut", source: "mock" };
const signedIn: AccountSessionView = {
  status: "signedIn",
  source: "mock",
  user: { id: "me", displayName: "测试用户" },
};
const period = { timezone: "Asia/Shanghai", startsAt: "2026-08-15T16:00:00Z", endsAt: "2026-08-16T16:00:00Z" };
const summary: AccountSummarySnapshot = {
  source: "mock",
  generatedAt: "2026-08-16T08:00:00Z",
  period,
  today: { input: "9007199254740993123", output: "300", cachedInput: "0", total: "9007199254740993423", requests: "2" },
  balance: { state: "available", value: "42.5", display: "¥42.50", unit: "CNY" },
  stale: false,
};
const leaderboard: LeaderboardSnapshot = {
  source: "mock",
  generatedAt: "2026-08-16T08:00:00Z",
  period,
  currentUserRank: 2,
  rows: [
    { rank: 1, userId: "first", displayName: "A***", tokens: "2500", isCurrentUser: false },
    { rank: 2, userId: "me", displayName: "测试用户", tokens: "1500", isCurrentUser: true },
  ],
  stale: false,
};

function createPlatform(initial: AccountSessionView = signedOut) {
  let session = initial;
  const apply = vi.fn().mockResolvedValue({ target: "codex", path: "config.toml", appliedAt: "2026-08-16T08:00:00Z", restartRequired: true });
  const platform: PlatformServices = {
    ...previewPlatform,
    kind: "desktop",
    openExternalUrl: vi.fn(async () => undefined),
    account: {
      getSession: vi.fn(async () => session),
      login: vi.fn(async () => { session = signedIn; return session; }),
      logout: vi.fn(async () => { session = signedOut; }),
      getSummary: vi.fn(async () => summary),
      getLeaderboard: vi.fn(async () => leaderboard),
      subscribeSession: () => () => undefined,
      subscribeSummary: () => () => undefined,
      subscribeLeaderboard: () => () => undefined,
    },
    cliConfig: {
      scan: vi.fn(async () => [{ target: "codex" as const, path: "C:\\.codex\\config.toml", health: "ready" as const, configuredForNetapi: false }]),
      preview: vi.fn(async () => ({ planId: "plan-1", target: "codex" as const, path: "C:\\.codex\\config.toml", changes: [{ field: "model_provider", action: "add" as const, after: "netapi" }], warnings: [], backupWillBeCreated: true })),
      apply,
      listBackups: vi.fn(async () => []),
      restore: vi.fn(),
      subscribe: () => () => undefined,
    },
  };
  return { platform, apply };
}

describe("AccountPage", () => {
  afterEach(cleanup);

  it("logs in and displays independently formatted usage data", async () => {
    const user = userEvent.setup();
    const { platform } = createPlatform();
    render(<AccountPage platform={platform} onNotify={vi.fn()} />);

    await screen.findByRole("heading", { name: "连接你的中转站账户" });
    await user.type(screen.getByPlaceholderText("邮箱或用户名"), "user@example.com");
    await user.type(screen.getByPlaceholderText("输入登录密码"), "secret");
    await user.click(screen.getByRole("button", { name: "登录 netapi.cc" }));

    expect(await screen.findByText("9,007,199,254,740,993,423")).toBeInTheDocument();
    expect(screen.getByText("¥42.50")).toBeInTheDocument();
    expect(screen.getByText("模拟数据")).toBeInTheDocument();
    expect(screen.getByText("A***")).toBeInTheDocument();
  });

  it("opens netapi registration with the platform browser gateway", async () => {
    const user = userEvent.setup();
    const { platform } = createPlatform();
    render(<AccountPage platform={platform} onNotify={vi.fn()} />);

    await user.click(await screen.findByRole("link", { name: /前往注册/ }));
    expect(platform.openExternalUrl).toHaveBeenCalledWith("https://netapi.cc/");
  });

  it("does not apply a client config before explicit preview confirmation", async () => {
    const user = userEvent.setup();
    const { platform, apply } = createPlatform(signedIn);
    render(<AccountPage platform={platform} onNotify={vi.fn()} />);

    await screen.findByText("一键配置 AI 工具");
    await user.click(screen.getAllByRole("button", { name: "配置" })[0]);
    expect(await screen.findByRole("dialog", { name: "Codex 配置预览" })).toBeInTheDocument();
    expect(apply).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认应用" }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith("plan-1"));
  });
});
