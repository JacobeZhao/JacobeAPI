import { SCHEMA_VERSION, type LibraryState, type McpTool, type Skill } from "../../src/domain/types";

const timestamp = "2026-08-15T12:00:00.000Z";

export function makeSkill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    kind: "skill",
    title: "Explain clearly",
    description: "A useful writing prompt",
    prompt: "Explain this for a beginner.",
    installNotes: "Copy this prompt.",
    tags: ["Writing"],
    favorite: false,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

export function makeMcp(overrides: Partial<McpTool> = {}): McpTool {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    kind: "mcp",
    title: "Filesystem",
    description: "Read local files",
    serverName: "filesystem",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    env: { ROOT_PATH: "C:\\Documents" },
    tags: ["Files"],
    favorite: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    ...overrides,
  };
}

export function makeState(overrides: Partial<LibraryState> = {}): LibraryState {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    skills: [makeSkill()],
    mcps: [makeMcp()],
    preferences: { managerView: "skills", sort: "updated-desc" },
    ...overrides,
  };
}

