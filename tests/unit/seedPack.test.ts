import { describe, expect, it } from "vitest";

import { createDefaultLibraryState } from "../../src/domain/defaults";
import { LIBRARY_LIMITS } from "../../src/domain/limits";
import { latestSeedPack, migrateToLatestSeedPack, seedPackV0 } from "../../src/domain/seedPack";

describe("seed packs", () => {
  it("defines the approved v1 starter pack without secrets", () => {
    expect(latestSeedPack.version).toBe(1);
    expect(latestSeedPack.skills.map(({ prompt }) => prompt)).toEqual([
      "$guided-multi-agent-development\n\n{{feature_request}}",
      "$continuous-technical-debt-cleanup\n\n{{repository_or_goal}}",
    ]);
    expect(latestSeedPack.mcps.map(({ serverName }) => serverName)).toEqual([
      "filesystem",
      "sequential-thinking",
      "playwright",
    ]);
    for (const mcp of latestSeedPack.mcps) {
      expect(mcp.command).toBe("cmd");
      expect(mcp.args.slice(0, 3)).toEqual(["/c", "npx", "-y"]);
      expect(mcp.env).toEqual({});
    }
  });

  it("creates new libraries directly from v1", () => {
    const state = createDefaultLibraryState();
    expect(state.revision).toBe(0);
    expect(state.skills).toEqual(latestSeedPack.skills);
    expect(state.mcps).toEqual(latestSeedPack.mcps);
  });

  it("replaces only untouched v0 cards and increments revision once", () => {
    const modifiedLegacy = { ...seedPackV0.skills[0], title: "我的自定义标题" };
    const state = {
      ...createDefaultLibraryState(),
      revision: 8,
      skills: [modifiedLegacy, seedPackV0.skills[1]],
      mcps: [...seedPackV0.mcps],
    };

    const migrated = migrateToLatestSeedPack(state);
    expect(migrated.changed).toBe(true);
    expect(migrated.state.revision).toBe(9);
    expect(migrated.state.skills).toContainEqual(modifiedLegacy);
    expect(migrated.state.skills).not.toContainEqual(seedPackV0.skills[1]);
    expect(migrated.state.mcps).not.toContainEqual(seedPackV0.mcps[0]);
    expect(migrateToLatestSeedPack(migrated.state)).toEqual({
      changed: false,
      deferred: false,
      state: migrated.state,
    });
  });

  it("defers the entire migration at card or revision limits", () => {
    const template = seedPackV0.skills[0];
    const fullState = {
      ...createDefaultLibraryState(),
      skills: Array.from({ length: LIBRARY_LIMITS.maxCards }, (_, index) => ({
        ...template,
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      })),
      mcps: [],
    };
    const atCapacity = migrateToLatestSeedPack(fullState);
    expect(atCapacity).toEqual({ changed: false, deferred: true, state: fullState });

    const atRevisionLimit = {
      ...createDefaultLibraryState(),
      revision: Number.MAX_SAFE_INTEGER,
      skills: [],
      mcps: [],
    };
    expect(migrateToLatestSeedPack(atRevisionLimit)).toEqual({
      changed: false,
      deferred: true,
      state: atRevisionLimit,
    });
  });

  it("preserves a user card that occupies a fixed v1 id", () => {
    const userCard = {
      ...seedPackV0.mcps[0],
      id: latestSeedPack.skills[0].id,
      title: "我的同 ID 工具",
    };
    const state = { ...createDefaultLibraryState(), skills: [], mcps: [userCard] };
    const migrated = migrateToLatestSeedPack(state);

    expect(migrated.state.mcps).toContainEqual(userCard);
    expect(migrated.state.skills.some(({ id }) => id === userCard.id)).toBe(false);
  });
});
