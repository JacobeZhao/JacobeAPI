import { SCHEMA_VERSION, type LibraryState } from "./types";
import { latestSeedPack } from "./seedPack";

export const starterSkills = latestSeedPack.skills;
export const starterMcps = latestSeedPack.mcps;

export function createDefaultLibraryState(): LibraryState {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    skills: structuredClone(starterSkills),
    mcps: structuredClone(starterMcps),
    preferences: { managerView: "skills", sort: "updated-desc" },
  };
}
