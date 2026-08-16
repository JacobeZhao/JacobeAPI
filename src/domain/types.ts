export const SCHEMA_VERSION = 1 as const;

export type LibraryView = "skills" | "mcps";
export type SortMode = "updated-desc" | "title-asc";

export interface CardBase {
  id: string;
  title: string;
  description: string;
  tags: string[];
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Skill extends CardBase {
  kind: "skill";
  prompt: string;
  installNotes: string;
}

export interface McpTool extends CardBase {
  kind: "mcp";
  serverName: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface LibraryPreferences {
  managerView: LibraryView;
  sort: SortMode;
}

export interface LibraryState {
  schemaVersion: typeof SCHEMA_VERSION;
  revision: number;
  skills: Skill[];
  mcps: McpTool[];
  preferences: LibraryPreferences;
}

export type CardEntity = Skill | McpTool;
export type ImportStrategy = "skip" | "overwrite" | "replace";

export interface ExportEnvelope {
  format: "jacobe-skills";
  schemaVersion: typeof SCHEMA_VERSION;
  appVersion: string;
  exportedAt: string;
  data: LibraryState;
}

export type LibraryMutation =
  | { type: "upsert-skill"; skill: Skill }
  | { type: "upsert-mcp"; mcp: McpTool }
  | { type: "delete-card"; kind: CardEntity["kind"]; id: string }
  | { type: "toggle-favorite"; kind: CardEntity["kind"]; id: string }
  | { type: "set-preferences"; preferences: Partial<LibraryPreferences> }
  | { type: "import-state"; state: LibraryState };

export interface MutationRequest {
  type: "MUTATE_LIBRARY";
  requestId: string;
  baseRevision: number;
  mutation: LibraryMutation;
}

export type RuntimeRequest =
  | { type: "GET_LIBRARY" }
  | MutationRequest
  | { type: "OPEN_MANAGER" };

export type RuntimeResponse =
  | { ok: true; state?: LibraryState }
  | { ok: false; code: "CONFLICT" | "INVALID" | "STORAGE" | "UNKNOWN"; message: string; state?: LibraryState };

export interface StateUpdatedMessage {
  type: "STATE_UPDATED";
  state: LibraryState;
}
