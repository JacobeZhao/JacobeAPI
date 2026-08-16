export type AccountDataSource = "live" | "mock";

export interface LoginRequest {
  identifier: string;
  password: string;
}

export interface AccountUserView {
  id: string;
  displayName: string;
}

export type AccountSessionView =
  | { status: "signedOut"; source: AccountDataSource }
  | { status: "signedIn"; source: AccountDataSource; user: AccountUserView; expiresAt?: string }
  | { status: "expired"; source: AccountDataSource; user?: AccountUserView; expiresAt?: string };

export interface DashboardTokenUsage {
  total: string;
  input: string;
  output: string;
  cachedInput: string;
  requests: string;
}

export type DashboardBalance =
  | { state: "available"; value: string; display: string; unit: string }
  | { state: "unavailable"; display: string; unit?: string; reason?: string }
  | { state: "unlimited"; display: string; unit?: string };

export interface DashboardPeriod {
  timezone: string;
  startsAt: string;
  endsAt: string;
}

export interface LeaderboardRow {
  rank: number;
  userId: string;
  displayName: string;
  tokens: string;
  isCurrentUser: boolean;
}

export interface AccountModelView {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface AccountSummarySnapshot {
  source: AccountDataSource;
  generatedAt: string;
  period: DashboardPeriod;
  today: DashboardTokenUsage;
  balance: DashboardBalance;
  stale: boolean;
}

export interface LeaderboardQuery {
  cursor?: string;
  limit?: number;
  forceRefresh?: boolean;
}

export interface LeaderboardSnapshot {
  source: AccountDataSource;
  generatedAt: string;
  period: DashboardPeriod;
  rows: LeaderboardRow[];
  currentUserRank?: number;
  nextCursor?: string;
  stale: boolean;
}

/** @deprecated Compatibility shape for the legacy get_dashboard IPC command. */
export interface DashboardSnapshot {
  source: AccountDataSource;
  generatedAt: string;
  period: DashboardPeriod;
  today: DashboardTokenUsage;
  balance: DashboardBalance;
  currentUserRank?: number;
  leaderboard: LeaderboardRow[];
  models?: AccountModelView[];
  stale?: boolean;
}
