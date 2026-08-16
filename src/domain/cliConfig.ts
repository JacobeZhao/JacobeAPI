export type CliTarget = "codex" | "claude";
export type CliConfigHealth = "missing" | "ready" | "invalid";

export interface CliConfigStatus {
  target: CliTarget;
  path: string;
  health: CliConfigHealth;
  configuredForNetapi: boolean;
}

export type CliConfigChangeAction = "add" | "update" | "remove";

export type CliConfigPreviewValue =
  | { kind: "absent" }
  | { kind: "redacted" }
  | { kind: "public"; value: string };

export interface CliConfigChange {
  key: string;
  action: CliConfigChangeAction;
  before: CliConfigPreviewValue;
  after: CliConfigPreviewValue;
}

export interface CliConfigPreview {
  planId: string;
  target: CliTarget;
  path: string;
  changes: CliConfigChange[];
  warnings: string[];
  backupWillBeCreated: boolean;
}

export interface CliConfigApplyResult {
  target: CliTarget;
  path: string;
  backupId?: string;
  appliedAt: string;
  restartRequired: boolean;
}

export interface CliConfigBackupView {
  id: string;
  target: CliTarget;
  path: string;
  createdAt: string;
}

export interface CliConfigRestoreResult {
  target: CliTarget;
  path: string;
  restoredAt: string;
  restartRequired: boolean;
}

export type CliConfigUpdate =
  | { kind: "applied"; result: CliConfigApplyResult }
  | { kind: "restored"; result: CliConfigRestoreResult };
