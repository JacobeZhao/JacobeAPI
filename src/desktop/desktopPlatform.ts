import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { applyMutation } from "../domain/mutations";
import type {
  AccountSessionView,
  AccountSummarySnapshot,
  LeaderboardQuery,
  LeaderboardSnapshot,
  LoginRequest,
} from "../domain/account";
import type {
  CliConfigApplyResult,
  CliConfigBackupView,
  CliConfigPreview,
  CliConfigRestoreResult,
  CliConfigStatus,
  CliTarget,
  CliConfigUpdate,
} from "../domain/cliConfig";
import type { LibraryMutation, LibraryState } from "../domain/types";
import type {
  DesktopPreferences,
  ManagerDestination,
  PlatformServices,
  SaveTextFileRequest,
  SelectedTextFile,
} from "../platform/contracts";

let pendingUpdate: Update | null = null;

function subscribeEvent<T>(event: string, listener: (payload: T) => void): () => void {
  let disposed = false;
  let stop: UnlistenFn | undefined;
  void listen<T>(event, ({ payload }) => listener(payload)).then((unlisten) => {
    if (disposed) unlisten();
    else stop = unlisten;
  });
  return () => {
    disposed = true;
    stop?.();
  };
}

async function getLibrary(): Promise<LibraryState> {
  return invoke<LibraryState>("get_library");
}

async function mutateLibrary(mutation: LibraryMutation, baseRevision: number): Promise<LibraryState> {
  const current = await getLibrary();
  const candidate = applyMutation(current, mutation);
  return invoke<LibraryState>("commit_library", { baseRevision, candidate });
}

function subscribeLibrary(listener: (state: LibraryState) => void): () => void {
  return subscribeEvent("library-updated", listener);
}

export const desktopPlatform: PlatformServices = {
  kind: "desktop",
  library: {
    getLibrary,
    mutateLibrary,
    subscribeLibrary,
    openManager: (destination?: ManagerDestination) => destination
      ? invoke<void>("show_manager", { destination })
      : invoke<void>("show_manager"),
  },
  account: {
    getSession: () => invoke<AccountSessionView>("get_account_session"),
    login: (request: LoginRequest) => invoke<AccountSessionView>("login_netapi", { request }),
    logout: () => invoke<void>("logout_netapi"),
    getSummary: (forceRefresh = false) => invoke<AccountSummarySnapshot>("get_account_summary", { forceRefresh }),
    getLeaderboard: (query: LeaderboardQuery = {}) => invoke<LeaderboardSnapshot>("get_leaderboard", { query }),
    subscribeSession: (listener) => subscribeEvent("account-session-updated", listener),
    subscribeSummary: (listener) => subscribeEvent("account-summary-updated", listener),
    subscribeLeaderboard: (listener) => subscribeEvent("leaderboard-updated", listener),
  },
  appUpdate: {
    check: async () => {
      await pendingUpdate?.close();
      pendingUpdate = await check({ timeout: 15_000 });
      return pendingUpdate ? {
        currentVersion: pendingUpdate.currentVersion,
        version: pendingUpdate.version,
        notes: pendingUpdate.body,
        date: pendingUpdate.date,
      } : null;
    },
    install: async (onProgress) => {
      if (!pendingUpdate) throw new Error("请先检查更新。");
      let downloaded = 0;
      let total = 0;
      await pendingUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") downloaded += event.data.chunkLength;
        if (event.event === "Finished") onProgress?.(100);
        else if (total > 0) onProgress?.(Math.min(99, Math.round((downloaded / total) * 100)));
      });
      await relaunch();
    },
  },
  cliConfig: {
    scan: () => invoke<CliConfigStatus[]>("scan_cli_configs"),
    preview: (target: CliTarget) => invoke<CliConfigPreview>("preview_cli_config", { target }),
    apply: (planId: string) => invoke<CliConfigApplyResult>("apply_cli_config", { planId }),
    listBackups: (target: CliTarget) => invoke<CliConfigBackupView[]>("list_cli_config_backups", { target }),
    restore: (backupId: string) => invoke<CliConfigRestoreResult>("restore_cli_config_backup", { backupId }),
    subscribe: (listener: (update: CliConfigUpdate) => void) => subscribeEvent("cli-config-updated", listener),
  },
  subscribeManagerDestination: (listener) => subscribeEvent("manager-navigate", listener),
  copyText: (text) => invoke<void>("copy_text", { text }),
  pickJsonFile: () => invoke<SelectedTextFile | null>("pick_json_file"),
  saveTextFile: (request: SaveTextFileRequest) => invoke<"saved" | "cancelled">("save_text_file", { request }),
  getDesktopPreferences: () => invoke<DesktopPreferences>("get_desktop_preferences"),
  setAutostart: (enabled) => invoke<DesktopPreferences>("set_autostart", { enabled }),
  setOrbVisible: (visible) => invoke<DesktopPreferences>("set_orb_visible", { visible }),
  setAlwaysOnTop: (enabled) => invoke<DesktopPreferences>("set_always_on_top", { enabled }),
  hideQuickPanel: () => invoke<void>("hide_quick_panel"),
  openExternalUrl: (url) => openUrl(url),
};
