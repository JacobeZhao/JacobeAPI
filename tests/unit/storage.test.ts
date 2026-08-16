import { describe, expect, it } from "vitest";

import { LIBRARY_LIMITS } from "../../src/domain/limits";
import { latestSeedPack, seedPackV0 } from "../../src/domain/seedPack";
import {
  LIBRARY_META_KEY,
  LIBRARY_SLOT_A_KEY,
  LIBRARY_SLOT_B_KEY,
  SEED_PACK_STATE_KEY,
} from "../../src/storage/constants";
import {
  LibraryConflictError,
  LibraryStorageCorruptionError,
  LibraryStorageLimitError,
  createLibraryStorage,
  type KeyValueStorage,
} from "../../src/storage/libraryStorage";
import { makeSkill, makeState } from "./fixtures";

class MemoryStorage implements KeyValueStorage {
  values: Record<string, unknown> = {};

  async get(keys: readonly string[]): Promise<Record<string, unknown>> {
    return Object.fromEntries(keys.map((key) => [key, structuredClone(this.values[key])]));
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
  }
}

describe("A/B library storage", () => {
  it("initializes defaults and persists a verified mutation", async () => {
    const backend = new MemoryStorage();
    const storage = createLibraryStorage(backend);
    const initial = await storage.loadLibraryState();
    const next = await storage.commitLibraryMutation(initial.revision, {
      type: "set-preferences",
      preferences: { managerView: "mcps" },
    });

    expect(next.revision).toBe(initial.revision + 1);
    expect(next.preferences.managerView).toBe("mcps");
    expect((backend.values[LIBRARY_META_KEY] as { activeSlot: string }).activeSlot).toBe("b");
    expect(await createLibraryStorage(backend).loadLibraryState()).toEqual(next);
  });

  it("rejects a stale base revision with the current state", async () => {
    const storage = createLibraryStorage(new MemoryStorage());
    const initial = await storage.loadLibraryState();
    await storage.commitLibraryMutation(initial.revision, {
      type: "set-preferences",
      preferences: { managerView: "mcps" },
    });

    await expect(
      storage.commitLibraryMutation(initial.revision, {
        type: "set-preferences",
        preferences: { sort: "title-asc" },
      }),
    ).rejects.toMatchObject({ name: "LibraryConflictError", currentState: { revision: 1 } });
    await expect(storage.commitLibraryMutation(initial.revision, { type: "import-state", state: initial })).rejects.toBeInstanceOf(
      LibraryConflictError,
    );
  });

  it("recovers the other slot when the active slot is damaged", async () => {
    const backend = new MemoryStorage();
    const storage = createLibraryStorage(backend);
    const initial = await storage.loadLibraryState();
    const revisionOne = await storage.commitLibraryMutation(initial.revision, {
      type: "set-preferences",
      preferences: { managerView: "mcps" },
    });
    await storage.commitLibraryMutation(revisionOne.revision, {
      type: "set-preferences",
      preferences: { sort: "title-asc" },
    });

    (backend.values[LIBRARY_SLOT_A_KEY] as { checksum: string }).checksum = "00000000";
    const recovered = await createLibraryStorage(backend).loadLibraryState();
    expect(recovered.revision).toBe(1);
    expect((backend.values[LIBRARY_META_KEY] as { activeSlot: string }).activeSlot).toBe("b");
  });

  it("does not overwrite storage when both existing slots are damaged", async () => {
    const backend = new MemoryStorage();
    backend.values[LIBRARY_SLOT_A_KEY] = { broken: true };
    backend.values[LIBRARY_SLOT_B_KEY] = { broken: true };
    await expect(createLibraryStorage(backend).loadLibraryState()).rejects.toBeInstanceOf(
      LibraryStorageCorruptionError,
    );
  });

  it("rejects a slot larger than four MiB before activation", async () => {
    const backend = new MemoryStorage();
    const storage = createLibraryStorage(backend);
    const initial = await storage.loadLibraryState();
    const largeSkills = Array.from({ length: 41 }, (_, index) =>
      makeSkill({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        prompt: "x".repeat(LIBRARY_LIMITS.maxContentLength),
      }),
    );
    const largeState = makeState({ revision: initial.revision, skills: largeSkills, mcps: [] });

    await expect(
      storage.commitLibraryMutation(initial.revision, { type: "import-state", state: largeState }),
    ).rejects.toBeInstanceOf(LibraryStorageLimitError);
    expect((backend.values[LIBRARY_META_KEY] as { revision: number }).revision).toBe(initial.revision);
  });

  it("migrates an existing v0 library once and writes a separate marker", async () => {
    const backend = new MemoryStorage();
    const storage = createLibraryStorage(backend);
    const initial = await storage.loadLibraryState();
    const legacy = makeState({
      revision: initial.revision,
      skills: structuredClone(seedPackV0.skills),
      mcps: structuredClone(seedPackV0.mcps),
    });
    const storedLegacy = await storage.commitLibraryMutation(initial.revision, {
      type: "import-state",
      state: legacy,
    });
    delete backend.values[SEED_PACK_STATE_KEY];

    const migrated = await createLibraryStorage(backend).loadLibraryState();
    expect(migrated.revision).toBe(storedLegacy.revision + 1);
    expect(migrated.skills).toEqual(latestSeedPack.skills);
    expect(migrated.mcps).toEqual(latestSeedPack.mcps);
    expect(backend.values[SEED_PACK_STATE_KEY]).toEqual({
      format: "jacobe-seed-pack-state",
      version: 1,
    });

    const loadedAgain = await createLibraryStorage(backend).loadLibraryState();
    expect(loadedAgain).toEqual(migrated);
  });

  it("preserves modified legacy cards and does not revive a deleted v1 preset", async () => {
    const backend = new MemoryStorage();
    const storage = createLibraryStorage(backend);
    const initial = await storage.loadLibraryState();
    const modified = { ...seedPackV0.skills[0], favorite: !seedPackV0.skills[0].favorite };
    const legacy = makeState({
      revision: initial.revision,
      skills: [modified, seedPackV0.skills[1]],
      mcps: structuredClone(seedPackV0.mcps),
    });
    const storedLegacy = await storage.commitLibraryMutation(initial.revision, {
      type: "import-state",
      state: legacy,
    });
    delete backend.values[SEED_PACK_STATE_KEY];

    const migrated = await createLibraryStorage(backend).loadLibraryState();
    expect(migrated.skills).toContainEqual(modified);
    const deletedId = latestSeedPack.skills[0].id;
    const afterDelete = await createLibraryStorage(backend).commitLibraryMutation(migrated.revision, {
      type: "delete-card",
      kind: "skill",
      id: deletedId,
    });
    const loadedAgain = await createLibraryStorage(backend).loadLibraryState();
    expect(loadedAgain.revision).toBe(afterDelete.revision);
    expect(loadedAgain.skills.some(({ id }) => id === deletedId)).toBe(false);
    expect(storedLegacy.revision + 2).toBe(afterDelete.revision);
  });

  it("keeps a full library readable and leaves migration unmarked for a later retry", async () => {
    const backend = new MemoryStorage();
    const storage = createLibraryStorage(backend);
    const initial = await storage.loadLibraryState();
    const fullState = makeState({
      revision: initial.revision,
      skills: Array.from({ length: LIBRARY_LIMITS.maxCards }, (_, index) =>
        makeSkill({ id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}` }),
      ),
      mcps: [],
    });
    const stored = await storage.commitLibraryMutation(initial.revision, {
      type: "import-state",
      state: fullState,
    });
    delete backend.values[SEED_PACK_STATE_KEY];

    const loaded = await createLibraryStorage(backend).loadLibraryState();
    expect(loaded).toEqual(stored);
    expect(backend.values[SEED_PACK_STATE_KEY]).toBeUndefined();
  });
});
