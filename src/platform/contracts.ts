import type { LibraryMutation, LibraryState } from "../domain/types";
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

export type PlatformKind = "extension" | "desktop" | "preview";
export type ManagerDestination = "library" | "account";

export interface LibraryGateway {
  getLibrary(): Promise<LibraryState>;
  mutateLibrary(mutation: LibraryMutation, baseRevision: number): Promise<LibraryState>;
  subscribeLibrary(listener: (state: LibraryState) => void): () => void;
  openManager(destination?: ManagerDestination): Promise<void>;
}

export interface AccountGateway {
  getSession(): Promise<AccountSessionView>;
  login(request: LoginRequest): Promise<AccountSessionView>;
  logout(): Promise<void>;
  getSummary(forceRefresh?: boolean): Promise<AccountSummarySnapshot>;
  getLeaderboard(query?: LeaderboardQuery): Promise<LeaderboardSnapshot>;
  subscribeSession(listener: (session: AccountSessionView) => void): () => void;
  subscribeSummary(listener: (summary: AccountSummarySnapshot) => void): () => void;
  subscribeLeaderboard(listener: (leaderboard: LeaderboardSnapshot) => void): () => void;
}

export interface CliConfigGateway {
  scan(): Promise<CliConfigStatus[]>;
  preview(target: CliTarget): Promise<CliConfigPreview>;
  apply(planId: string): Promise<CliConfigApplyResult>;
  listBackups(target: CliTarget): Promise<CliConfigBackupView[]>;
  restore(backupId: string): Promise<CliConfigRestoreResult>;
  subscribe(listener: (update: CliConfigUpdate) => void): () => void;
}

export interface SelectedTextFile {
  name: string;
  text: string;
}

export interface SaveTextFileRequest {
  content: string;
  defaultName: string;
  extension: "json" | "md";
}

export interface DesktopPreferences {
  autostartEnabled: boolean;
  orbVisible: boolean;
  alwaysOnTop: boolean;
}

export interface AppUpdateInfo {
  currentVersion: string;
  version: string;
  notes?: string;
  date?: string;
}

export interface AppUpdateGateway {
  check(): Promise<AppUpdateInfo | null>;
  install(onProgress?: (percent: number) => void): Promise<void>;
}

export interface PlatformServices {
  kind: PlatformKind;
  library: LibraryGateway;
  account?: AccountGateway;
  cliConfig?: CliConfigGateway;
  appUpdate?: AppUpdateGateway;
  subscribeManagerDestination?(listener: (destination: ManagerDestination) => void): () => void;
  copyText(text: string): Promise<void>;
  pickJsonFile(): Promise<SelectedTextFile | null>;
  saveTextFile(request: SaveTextFileRequest): Promise<"saved" | "cancelled">;
  getDesktopPreferences?(): Promise<DesktopPreferences>;
  setAutostart?(enabled: boolean): Promise<DesktopPreferences>;
  setOrbVisible?(visible: boolean): Promise<DesktopPreferences>;
  setAlwaysOnTop?(enabled: boolean): Promise<DesktopPreferences>;
  hideQuickPanel?(): Promise<void>;
  openExternalUrl?(url: string): Promise<void>;
}
