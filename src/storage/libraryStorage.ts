import { z } from "zod";

import { createDefaultLibraryState } from "../domain/defaults";
import { LIBRARY_LIMITS } from "../domain/limits";
import { applyMutation } from "../domain/mutations";
import { libraryStateSchema } from "../domain/schema";
import { latestSeedPack, migrateToLatestSeedPack } from "../domain/seedPack";
import { SCHEMA_VERSION, type LibraryMutation, type LibraryState } from "../domain/types";
import {
  LIBRARY_META_KEY,
  LIBRARY_SLOT_A_KEY,
  LIBRARY_SLOT_B_KEY,
  LIBRARY_STORAGE_KEYS,
  SEED_PACK_STATE_KEY,
} from "./constants";

type SlotName = "a" | "b";

interface StoredSlot {
  format: "jacobe-library-slot";
  schemaVersion: typeof SCHEMA_VERSION;
  revision: number;
  checksum: string;
  state: LibraryState;
}

interface StoredMeta {
  format: "jacobe-library-meta";
  schemaVersion: typeof SCHEMA_VERSION;
  activeSlot: SlotName;
  revision: number;
}

interface StoredSeedPackState {
  format: "jacobe-seed-pack-state";
  version: number;
}

export interface KeyValueStorage {
  get(keys: readonly string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export class LibraryStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LibraryStorageError";
  }
}

export class LibraryConflictError extends LibraryStorageError {
  constructor(readonly currentState: LibraryState) {
    super("The library changed in another view. Reload it and try again.");
    this.name = "LibraryConflictError";
  }
}

export class LibraryStorageLimitError extends LibraryStorageError {
  constructor(readonly bytes: number) {
    super(`Library slot is ${bytes} bytes; the limit is ${LIBRARY_LIMITS.maxSlotBytes} bytes.`);
    this.name = "LibraryStorageLimitError";
  }
}

export class LibraryStorageCorruptionError extends LibraryStorageError {
  constructor(message = "Both library storage slots are damaged.") {
    super(message);
    this.name = "LibraryStorageCorruptionError";
  }
}

const storedSlotSchema: z.ZodType<StoredSlot> = z
  .object({
    format: z.literal("jacobe-library-slot"),
    schemaVersion: z.literal(SCHEMA_VERSION),
    revision: z.number().int().nonnegative().safe(),
    checksum: z.string().regex(/^[0-9a-f]{8}$/),
    state: libraryStateSchema,
  })
  .strict();

const storedMetaSchema: z.ZodType<StoredMeta> = z
  .object({
    format: z.literal("jacobe-library-meta"),
    schemaVersion: z.literal(SCHEMA_VERSION),
    activeSlot: z.enum(["a", "b"]),
    revision: z.number().int().nonnegative().safe(),
  })
  .strict();

const storedSeedPackStateSchema: z.ZodType<StoredSeedPackState> = z
  .object({
    format: z.literal("jacobe-seed-pack-state"),
    version: z.number().int().nonnegative().safe(),
  })
  .strict();

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function checksum(value: string): string {
  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function makeSlot(stateValue: LibraryState): StoredSlot {
  const state = libraryStateSchema.parse(stateValue);
  const slot: StoredSlot = {
    format: "jacobe-library-slot",
    schemaVersion: SCHEMA_VERSION,
    revision: state.revision,
    checksum: checksum(JSON.stringify(state)),
    state,
  };
  const bytes = utf8Bytes(JSON.stringify(slot));
  if (bytes > LIBRARY_LIMITS.maxSlotBytes) throw new LibraryStorageLimitError(bytes);
  return slot;
}

function parseSlot(value: unknown): StoredSlot | undefined {
  const result = storedSlotSchema.safeParse(value);
  if (!result.success) return undefined;
  const slot = result.data;
  if (slot.revision !== slot.state.revision) return undefined;
  if (slot.checksum !== checksum(JSON.stringify(slot.state))) return undefined;
  return slot;
}

function parseMeta(value: unknown): StoredMeta | undefined {
  const result = storedMetaSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function parseSeedPackState(value: unknown): StoredSeedPackState | undefined {
  const result = storedSeedPackStateSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function keyForSlot(slot: SlotName): string {
  return slot === "a" ? LIBRARY_SLOT_A_KEY : LIBRARY_SLOT_B_KEY;
}

function otherSlot(slot: SlotName): SlotName {
  return slot === "a" ? "b" : "a";
}

function metaFor(slot: SlotName, revision: number): StoredMeta {
  return {
    format: "jacobe-library-meta",
    schemaVersion: SCHEMA_VERSION,
    activeSlot: slot,
    revision,
  };
}

async function verifiedSet(storage: KeyValueStorage, key: string, value: unknown): Promise<unknown> {
  await storage.set({ [key]: value });
  const readBack = await storage.get([key]);
  return readBack[key];
}

export function createChromeStorageAdapter(area: chrome.storage.StorageArea): KeyValueStorage {
  return {
    async get(keys) {
      return area.get([...keys]);
    },
    async set(items) {
      await area.set(items);
    },
  };
}

export function createLibraryStorage(storage: KeyValueStorage) {
  let commitQueue: Promise<unknown> = Promise.resolve();

  async function initialize(): Promise<{ state: LibraryState; activeSlot: SlotName }> {
    const state = libraryStateSchema.parse(createDefaultLibraryState());
    const slot = makeSlot(state);
    const slotReadBack = parseSlot(await verifiedSet(storage, LIBRARY_SLOT_A_KEY, slot));
    if (!slotReadBack) throw new LibraryStorageCorruptionError("Initial library slot failed read-back validation.");

    const meta = metaFor("a", state.revision);
    const metaReadBack = parseMeta(await verifiedSet(storage, LIBRARY_META_KEY, meta));
    if (!metaReadBack || metaReadBack.activeSlot !== "a" || metaReadBack.revision !== state.revision) {
      throw new LibraryStorageCorruptionError("Initial library metadata failed read-back validation.");
    }
    await writeSeedPackState();
    return { state, activeSlot: "a" };
  }

  async function writeSeedPackState(): Promise<void> {
    const marker: StoredSeedPackState = {
      format: "jacobe-seed-pack-state",
      version: latestSeedPack.version,
    };
    const readBack = parseSeedPackState(await verifiedSet(storage, SEED_PACK_STATE_KEY, marker));
    if (!readBack || readBack.version !== latestSeedPack.version) {
      throw new LibraryStorageCorruptionError("Seed pack state failed read-back validation.");
    }
  }

  async function loadStoredLibrary(): Promise<{ state: LibraryState; activeSlot: SlotName }> {
    let values: Record<string, unknown>;
    try {
      values = await storage.get(LIBRARY_STORAGE_KEYS);
    } catch (error) {
      throw new LibraryStorageError("Unable to read the local library.", { cause: error });
    }

    const slotA = parseSlot(values[LIBRARY_SLOT_A_KEY]);
    const slotB = parseSlot(values[LIBRARY_SLOT_B_KEY]);
    const meta = parseMeta(values[LIBRARY_META_KEY]);
    const hasStoredData = LIBRARY_STORAGE_KEYS.some((key) => values[key] !== undefined);

    if (!slotA && !slotB) {
      if (hasStoredData) throw new LibraryStorageCorruptionError();
      return initialize();
    }

    const slots: Partial<Record<SlotName, StoredSlot>> = { a: slotA, b: slotB };
    if (meta) {
      const active = slots[meta.activeSlot];
      if (active && active.revision === meta.revision) {
        return { state: active.state, activeSlot: meta.activeSlot };
      }
    }

    const recoveredSlot: SlotName = slotA && (!slotB || slotA.revision >= slotB.revision) ? "a" : "b";
    const recovered = slots[recoveredSlot];
    if (!recovered) throw new LibraryStorageCorruptionError();

    const repairedMeta = metaFor(recoveredSlot, recovered.revision);
    const readBack = parseMeta(await verifiedSet(storage, LIBRARY_META_KEY, repairedMeta));
    if (!readBack || readBack.activeSlot !== recoveredSlot || readBack.revision !== recovered.revision) {
      throw new LibraryStorageCorruptionError("Recovered library metadata failed read-back validation.");
    }
    return { state: recovered.state, activeSlot: recoveredSlot };
  }

  async function loadInternal(): Promise<{ state: LibraryState; activeSlot: SlotName }> {
    const current = await loadStoredLibrary();
    let markerValue: Record<string, unknown>;
    try {
      markerValue = await storage.get([SEED_PACK_STATE_KEY]);
    } catch (error) {
      throw new LibraryStorageError("Unable to read the seed pack state.", { cause: error });
    }
    const marker = parseSeedPackState(markerValue[SEED_PACK_STATE_KEY]);
    if (marker && marker.version >= latestSeedPack.version) return current;

    const migration = migrateToLatestSeedPack(current.state);
    if (migration.deferred) return current;
    let migrated = current;
    if (migration.changed) {
      const destination = otherSlot(current.activeSlot);
      const nextSlot = makeSlot(libraryStateSchema.parse(migration.state));
      const slotReadBack = parseSlot(await verifiedSet(storage, keyForSlot(destination), nextSlot));
      if (!slotReadBack || slotReadBack.revision !== migration.state.revision) {
        throw new LibraryStorageCorruptionError("Migrated library slot failed read-back validation.");
      }
      const nextMeta = metaFor(destination, migration.state.revision);
      const metaReadBack = parseMeta(await verifiedSet(storage, LIBRARY_META_KEY, nextMeta));
      if (
        !metaReadBack ||
        metaReadBack.activeSlot !== destination ||
        metaReadBack.revision !== migration.state.revision
      ) {
        throw new LibraryStorageCorruptionError("Migrated library metadata failed read-back validation.");
      }
      migrated = { state: migration.state, activeSlot: destination };
    }
    await writeSeedPackState();
    return migrated;
  }

  async function loadLibraryState(): Promise<LibraryState> {
    return (await loadInternal()).state;
  }

  async function commitNow(baseRevision: number, mutation: LibraryMutation): Promise<LibraryState> {
    const current = await loadInternal();
    if (current.state.revision !== baseRevision) throw new LibraryConflictError(current.state);

    const nextState = applyMutation(current.state, mutation);
    const destination = otherSlot(current.activeSlot);
    const nextSlot = makeSlot(nextState);

    let slotReadBack: StoredSlot | undefined;
    try {
      slotReadBack = parseSlot(await verifiedSet(storage, keyForSlot(destination), nextSlot));
    } catch (error) {
      if (error instanceof LibraryStorageError) throw error;
      throw new LibraryStorageError("Unable to write the new library slot.", { cause: error });
    }
    if (!slotReadBack || slotReadBack.revision !== nextState.revision) {
      throw new LibraryStorageCorruptionError("New library slot failed read-back validation.");
    }

    const nextMeta = metaFor(destination, nextState.revision);
    let metaReadBack: StoredMeta | undefined;
    try {
      metaReadBack = parseMeta(await verifiedSet(storage, LIBRARY_META_KEY, nextMeta));
    } catch (error) {
      throw new LibraryStorageError("Unable to activate the new library slot.", { cause: error });
    }
    if (
      !metaReadBack ||
      metaReadBack.activeSlot !== destination ||
      metaReadBack.revision !== nextState.revision
    ) {
      throw new LibraryStorageCorruptionError("New library metadata failed read-back validation.");
    }
    return nextState;
  }

  function commitLibraryMutation(baseRevision: number, mutation: LibraryMutation): Promise<LibraryState> {
    const operation = commitQueue.then(() => commitNow(baseRevision, mutation));
    commitQueue = operation.catch(() => undefined);
    return operation;
  }

  return { loadLibraryState, commitLibraryMutation };
}

let defaultLibraryStorage: ReturnType<typeof createLibraryStorage> | undefined;

function getDefaultLibraryStorage() {
  if (!defaultLibraryStorage) {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      throw new LibraryStorageError("Chrome local storage is unavailable.");
    }
    defaultLibraryStorage = createLibraryStorage(createChromeStorageAdapter(chrome.storage.local));
  }
  return defaultLibraryStorage;
}

export function loadLibraryState(): Promise<LibraryState> {
  return getDefaultLibraryStorage().loadLibraryState();
}

export function commitLibraryMutation(baseRevision: number, mutation: LibraryMutation): Promise<LibraryState> {
  return getDefaultLibraryStorage().commitLibraryMutation(baseRevision, mutation);
}

export function subscribeLibrary(listener: (state: LibraryState) => void): () => void {
  if (typeof chrome === "undefined" || !chrome.storage?.onChanged) return () => undefined;

  const handleChange = (changes: Record<string, chrome.storage.StorageChange>, areaName: string) => {
    if (areaName !== "local" || !changes[LIBRARY_META_KEY]) return;
    void loadLibraryState().then(listener).catch(() => undefined);
  };
  chrome.storage.onChanged.addListener(handleChange);
  return () => chrome.storage.onChanged.removeListener(handleChange);
}
