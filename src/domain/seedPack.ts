import { z } from "zod";

import seedPackV0Json from "../../seed-packs/v0.json";
import seedPackV1Json from "../../seed-packs/v1.json";
import { LIBRARY_LIMITS } from "./limits";
import { mcpToolSchema, skillSchema } from "./schema";
import type { LibraryState, McpTool, Skill } from "./types";

const seedPackSchema = z
  .object({
    version: z.number().int().nonnegative(),
    skills: z.array(skillSchema),
    mcps: z.array(mcpToolSchema),
  })
  .strict();

export interface SeedPack {
  version: number;
  skills: Skill[];
  mcps: McpTool[];
}

export const seedPackV0: SeedPack = seedPackSchema.parse(seedPackV0Json);
export const latestSeedPack: SeedPack = seedPackSchema.parse(seedPackV1Json);

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function equalCard(left: Skill | McpTool, right: Skill | McpTool): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

export interface SeedPackMigrationResult {
  state: LibraryState;
  changed: boolean;
  deferred: boolean;
}

export function migrateToLatestSeedPack(state: LibraryState): SeedPackMigrationResult {
  const skills = state.skills.filter(
    (card) => !seedPackV0.skills.some((legacy) => legacy.id === card.id && equalCard(legacy, card)),
  );
  const mcps = state.mcps.filter(
    (card) => !seedPackV0.mcps.some((legacy) => legacy.id === card.id && equalCard(legacy, card)),
  );
  const occupiedIds = new Set([...skills, ...mcps].map(({ id }) => id.toLowerCase()));

  for (const skill of latestSeedPack.skills) {
    if (!occupiedIds.has(skill.id.toLowerCase())) {
      skills.push(structuredClone(skill));
      occupiedIds.add(skill.id.toLowerCase());
    }
  }
  for (const mcp of latestSeedPack.mcps) {
    if (!occupiedIds.has(mcp.id.toLowerCase())) {
      mcps.push(structuredClone(mcp));
      occupiedIds.add(mcp.id.toLowerCase());
    }
  }

  const changed =
    skills.length !== state.skills.length ||
    mcps.length !== state.mcps.length ||
    skills.some((card, index) => card !== state.skills[index]) ||
    mcps.some((card, index) => card !== state.mcps[index]);
  if (
    changed &&
    (skills.length + mcps.length > LIBRARY_LIMITS.maxCards || state.revision >= Number.MAX_SAFE_INTEGER)
  ) {
    return { changed: false, deferred: true, state };
  }
  return {
    changed,
    deferred: false,
    state: changed ? { ...state, revision: state.revision + 1, skills, mcps } : state,
  };
}
