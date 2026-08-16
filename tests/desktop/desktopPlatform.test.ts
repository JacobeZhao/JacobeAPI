import { act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultLibraryState } from "../../src/domain/defaults";
import type {
  AccountSessionView,
  AccountSummarySnapshot,
  LeaderboardSnapshot,
  LoginRequest,
} from "../../src/domain/account";
import type { CliConfigUpdate } from "../../src/domain/cliConfig";
import type { LibraryState } from "../../src/domain/types";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listen: vi.fn(),
  unlisten: vi.fn(),
  openUrl: vi.fn(),
  checkUpdate: vi.fn(),
  downloadAndInstall: vi.fn(),
  closeUpdate: vi.fn(),
  relaunch: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mocks.relaunch }));
vi.mock("@tauri-apps/plugin-updater", () => ({ check: mocks.checkUpdate }));

import { desktopPlatform } from "../../src/desktop/desktopPlatform";

describe("desktopPlatform", () => {
  let state: LibraryState;

  beforeEach(() => {
    vi.clearAllMocks();
    state = createDefaultLibraryState();
    mocks.listen.mockResolvedValue(mocks.unlisten);
    mocks.openUrl.mockResolvedValue(undefined);
    mocks.relaunch.mockResolvedValue(undefined);
    mocks.invoke.mockImplementation((command: string, args?: unknown) => {
      if (command === "get_library") return Promise.resolve(state);
      if (command === "commit_library") return Promise.resolve((args as { candidate: LibraryState }).candidate);
      return Promise.resolve(undefined);
    });
  });

  it("opens registration externally and installs a checked update", async () => {
    mocks.downloadAndInstall.mockImplementation(async (listener: (event: unknown) => void) => {
      listener({ event: "Started", data: { contentLength: 10 } });
      listener({ event: "Progress", data: { chunkLength: 10 } });
      listener({ event: "Finished" });
    });
    mocks.checkUpdate.mockResolvedValue({
      currentVersion: "0.1.1",
      version: "0.1.2",
      body: "更新说明",
      date: "2026-08-16T00:00:00Z",
      downloadAndInstall: mocks.downloadAndInstall,
      close: mocks.closeUpdate,
    });
    const progress = vi.fn();

    await desktopPlatform.openExternalUrl?.("https://netapi.cc/");
    expect(await desktopPlatform.appUpdate?.check()).toEqual(expect.objectContaining({ version: "0.1.2" }));
    await desktopPlatform.appUpdate?.install(progress);

    expect(mocks.openUrl).toHaveBeenCalledWith("https://netapi.cc/");
    expect(progress).toHaveBeenLastCalledWith(100);
    expect(mocks.relaunch).toHaveBeenCalledOnce();
  });

  it("builds a validated candidate before committing it", async () => {
    const skill = state.skills[0];
    const next = await desktopPlatform.library.mutateLibrary(
      { type: "toggle-favorite", kind: "skill", id: skill.id },
      state.revision,
    );

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "get_library");
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "commit_library", {
      baseRevision: state.revision,
      candidate: expect.objectContaining({ revision: state.revision + 1 }),
    });
    expect(next.skills[0].favorite).toBe(!skill.favorite);
  });

  it("forwards library events and safely releases an async listener", async () => {
    let eventHandler: ((event: { payload: LibraryState }) => void) | undefined;
    mocks.listen.mockImplementation((_event: string, handler: (event: { payload: LibraryState }) => void) => {
      eventHandler = handler;
      return Promise.resolve(mocks.unlisten);
    });
    const listener = vi.fn();
    const unsubscribe = desktopPlatform.library.subscribeLibrary(listener);

    await act(async () => Promise.resolve());
    eventHandler?.({ payload: state });
    expect(mocks.listen).toHaveBeenCalledWith("library-updated", expect.any(Function));
    expect(listener).toHaveBeenCalledWith(state);

    unsubscribe();
    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });

  it("uses the frozen desktop command names and camelCase arguments", async () => {
    await desktopPlatform.copyText("hello");
    await desktopPlatform.setAutostart?.(true);
    await desktopPlatform.setOrbVisible?.(false);
    await desktopPlatform.setAlwaysOnTop?.(true);
    await desktopPlatform.hideQuickPanel?.();

    expect(mocks.invoke).toHaveBeenCalledWith("copy_text", { text: "hello" });
    expect(mocks.invoke).toHaveBeenCalledWith("set_autostart", { enabled: true });
    expect(mocks.invoke).toHaveBeenCalledWith("set_orb_visible", { visible: false });
    expect(mocks.invoke).toHaveBeenCalledWith("set_always_on_top", { enabled: true });
    expect(mocks.invoke).toHaveBeenCalledWith("hide_quick_panel");
  });

  it("opens the manager at an optional destination without changing the legacy call", async () => {
    await desktopPlatform.library.openManager();
    await desktopPlatform.library.openManager("account");

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "show_manager");
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "show_manager", { destination: "account" });
  });

  it("forwards account commands with frozen names and request shapes", async () => {
    const login: LoginRequest = {
      identifier: "beginner",
      password: "secret",
    };

    await desktopPlatform.account?.getSession();
    await desktopPlatform.account?.login(login);
    await desktopPlatform.account?.getSummary();
    await desktopPlatform.account?.getSummary(true);
    await desktopPlatform.account?.getLeaderboard({ cursor: "next", limit: 25, forceRefresh: true });
    await desktopPlatform.account?.logout();

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "get_account_session");
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "login_netapi", { request: login });
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "get_account_summary", { forceRefresh: false });
    expect(mocks.invoke).toHaveBeenNthCalledWith(4, "get_account_summary", { forceRefresh: true });
    expect(mocks.invoke).toHaveBeenNthCalledWith(5, "get_leaderboard", { query: { cursor: "next", limit: 25, forceRefresh: true } });
    expect(mocks.invoke).toHaveBeenNthCalledWith(6, "logout_netapi");
  });

  it("forwards CLI configuration commands with frozen names and request shapes", async () => {
    await desktopPlatform.cliConfig?.scan();
    await desktopPlatform.cliConfig?.preview("codex");
    await desktopPlatform.cliConfig?.apply("preview-1");
    await desktopPlatform.cliConfig?.listBackups("codex");
    await desktopPlatform.cliConfig?.restore("backup-1");

    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "scan_cli_configs");
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "preview_cli_config", { target: "codex" });
    expect(mocks.invoke).toHaveBeenNthCalledWith(3, "apply_cli_config", { planId: "preview-1" });
    expect(mocks.invoke).toHaveBeenNthCalledWith(4, "list_cli_config_backups", { target: "codex" });
    expect(mocks.invoke).toHaveBeenNthCalledWith(5, "restore_cli_config_backup", { backupId: "backup-1" });
  });

  it("forwards account and CLI events and releases their listeners", async () => {
    const handlers = new Map<string, (event: { payload: unknown }) => void>();
    mocks.listen.mockImplementation((event: string, handler: (event: { payload: unknown }) => void) => {
      handlers.set(event, handler);
      return Promise.resolve(mocks.unlisten);
    });
    const sessionListener = vi.fn();
    const summaryListener = vi.fn();
    const leaderboardListener = vi.fn();
    const configListener = vi.fn();
    const destinationListener = vi.fn();
    const stopSession = desktopPlatform.account?.subscribeSession(sessionListener);
    const stopSummary = desktopPlatform.account?.subscribeSummary(summaryListener);
    const stopLeaderboard = desktopPlatform.account?.subscribeLeaderboard(leaderboardListener);
    const stopConfig = desktopPlatform.cliConfig?.subscribe(configListener);
    const stopDestination = desktopPlatform.subscribeManagerDestination?.(destinationListener);
    await act(async () => Promise.resolve());

    const session = { status: "signedIn" } as AccountSessionView;
    const summary = { source: "mock" } as AccountSummarySnapshot;
    const leaderboard = { source: "mock" } as LeaderboardSnapshot;
    const update = { kind: "applied" } as CliConfigUpdate;
    handlers.get("account-session-updated")?.({ payload: session });
    handlers.get("account-summary-updated")?.({ payload: summary });
    handlers.get("leaderboard-updated")?.({ payload: leaderboard });
    handlers.get("cli-config-updated")?.({ payload: update });
    handlers.get("manager-navigate")?.({ payload: "account" });

    expect(sessionListener).toHaveBeenCalledWith(session);
    expect(summaryListener).toHaveBeenCalledWith(summary);
    expect(leaderboardListener).toHaveBeenCalledWith(leaderboard);
    expect(configListener).toHaveBeenCalledWith(update);
    expect(destinationListener).toHaveBeenCalledWith("account");
    stopSession?.();
    stopSummary?.();
    stopLeaderboard?.();
    stopConfig?.();
    stopDestination?.();
    expect(mocks.unlisten).toHaveBeenCalledTimes(5);
  });

  it("releases an event listener that resolves after disposal", async () => {
    let resolveListen: ((unlisten: typeof mocks.unlisten) => void) | undefined;
    mocks.listen.mockReturnValue(new Promise((resolve) => {
      resolveListen = resolve;
    }));
    const stop = desktopPlatform.account?.subscribeSession(vi.fn());

    stop?.();
    resolveListen?.(mocks.unlisten);
    await act(async () => Promise.resolve());

    expect(mocks.unlisten).toHaveBeenCalledOnce();
  });
});
