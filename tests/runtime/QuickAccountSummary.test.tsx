import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountSessionView, AccountSummarySnapshot } from "../../src/domain/account";
import { QuickAccountSummary } from "../../src/features/account/QuickAccountSummary";
import type { AccountGateway, PlatformServices } from "../../src/platform/contracts";

const signedIn: AccountSessionView = {
  status: "signedIn",
  source: "mock",
  user: { id: "demo", displayName: "Demo" },
};

const summary: AccountSummarySnapshot = {
  source: "mock",
  generatedAt: "2026-08-16T03:00:00Z",
  period: {
    timezone: "Asia/Shanghai",
    startsAt: "2026-08-15T16:00:00Z",
    endsAt: "2026-08-16T16:00:00Z",
  },
  today: {
    input: "9007199254740993000000000",
    output: "123456789",
    cachedInput: "0",
    total: "9007199254740993123456789",
    requests: "42",
  },
  balance: { state: "available", value: "88.50", display: "¥88.50", unit: "CNY" },
  stale: true,
};

function createPlatform(overrides: Partial<AccountGateway> = {}): PlatformServices {
  const account: AccountGateway = {
    getSession: vi.fn(async () => signedIn),
    login: vi.fn(),
    logout: vi.fn(),
    getSummary: vi.fn(async () => summary),
    getLeaderboard: vi.fn(),
    subscribeSession: vi.fn(() => () => undefined),
    subscribeSummary: vi.fn(() => () => undefined),
    subscribeLeaderboard: vi.fn(() => () => undefined),
    ...overrides,
  };
  return {
    kind: "desktop",
    account,
    library: {
      getLibrary: vi.fn(),
      mutateLibrary: vi.fn(),
      subscribeLibrary: vi.fn(() => () => undefined),
      openManager: vi.fn(),
    },
    copyText: vi.fn(),
    pickJsonFile: vi.fn(),
    saveTextFile: vi.fn(),
  };
}

describe("QuickAccountSummary", () => {
  afterEach(cleanup);

  it("renders a non-interactive summary and preserves very large token values", async () => {
    render(<QuickAccountSummary platform={createPlatform()} />);

    const footer = await screen.findByRole("contentinfo", { name: "账户摘要" });
    expect(within(footer).getByText("9,007,199,254,740,993,123,456,789")).toBeInTheDocument();
    expect(within(footer).getByText("¥88.50")).toBeInTheDocument();
    expect(within(footer).getByText("Mock 数据 · 旧数据")).toBeInTheDocument();
    expect(within(footer).queryByRole("button")).not.toBeInTheDocument();
    expect(within(footer).queryByRole("link")).not.toBeInTheDocument();
  });

  it.each([
    [{ status: "signedOut", source: "live" } satisfies AccountSessionView, "未登录"],
    [{ status: "expired", source: "live" } satisfies AccountSessionView, "登录已过期"],
  ])("shows the session state without requesting usage", async (session, label) => {
    const platform = createPlatform({ getSession: vi.fn(async () => session) });
    render(<QuickAccountSummary platform={platform} />);

    expect(await screen.findByText(label)).toBeInTheDocument();
    expect(platform.account?.getSummary).not.toHaveBeenCalled();
    expect(screen.getAllByText("--")).toHaveLength(2);
  });

  it("shows loading and account errors without adding a retry control", async () => {
    let rejectSession: ((reason: Error) => void) | undefined;
    const platform = createPlatform({
      getSession: vi.fn(() => new Promise<AccountSessionView>((_, reject) => { rejectSession = reject; })),
    });
    render(<QuickAccountSummary platform={platform} />);

    expect(screen.getByText("读取中")).toBeInTheDocument();
    rejectSession?.(new Error("offline"));
    await waitFor(() => expect(screen.getByText("账户暂不可用")).toBeInTheDocument());
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("omits the footer when the platform has no account gateway", () => {
    const platform = createPlatform();
    delete platform.account;
    render(<QuickAccountSummary platform={platform} />);
    expect(screen.queryByRole("contentinfo", { name: "账户摘要" })).not.toBeInTheDocument();
  });

  it("keeps the last values as stale data when a focus refresh fails", async () => {
    const freshSummary = { ...summary, stale: false };
    const getSummary = vi.fn()
      .mockResolvedValueOnce(freshSummary)
      .mockRejectedValueOnce(new Error("offline"));
    render(<QuickAccountSummary platform={createPlatform({ getSummary })} />);

    expect(await screen.findByText("9,007,199,254,740,993,123,456,789")).toBeInTheDocument();
    window.dispatchEvent(new Event("focus"));

    await waitFor(() => expect(screen.getByText("Mock 数据 · 旧数据")).toBeInTheDocument());
    expect(screen.getByText("¥88.50")).toBeInTheDocument();
  });
});
