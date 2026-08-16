import { z } from "zod";

import { LIBRARY_LIMITS } from "../domain/limits";
import { migrateLibraryState, UnsupportedSchemaVersionError } from "../domain/migrations";
import { DANGEROUS_OBJECT_KEYS, libraryStateSchema } from "../domain/schema";
import {
  SCHEMA_VERSION,
  type ExportEnvelope,
  type ImportStrategy,
  type LibraryState,
  type McpTool,
  type Skill,
} from "../domain/types";

export interface ImportKindPreview {
  incoming: number;
  added: number;
  overwritten: number;
  skipped: number;
  removed: number;
}

export interface ImportPreview {
  strategy: ImportStrategy;
  skills: ImportKindPreview;
  mcps: ImportKindPreview;
  totalCards: number;
  conflicts: string[];
  candidate: LibraryState;
}

export class LibraryImportError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "LibraryImportError";
  }
}

export class LibraryImportSizeError extends LibraryImportError {
  constructor(readonly bytes: number) {
    super(`Import is ${bytes} bytes; the limit is ${LIBRARY_LIMITS.maxImportBytes} bytes.`);
    this.name = "LibraryImportSizeError";
  }
}

export class UnsafeImportKeyError extends LibraryImportError {
  constructor(readonly key: string) {
    super(`Import contains an unsafe object key: ${key}`);
    this.name = "UnsafeImportKeyError";
  }
}

const exportEnvelopeSchema: z.ZodType<ExportEnvelope> = z
  .object({
    format: z.literal("jacobe-skills"),
    schemaVersion: z.literal(SCHEMA_VERSION),
    appVersion: z.string().min(1).max(50),
    exportedAt: z.iso.datetime({ offset: true }),
    data: libraryStateSchema,
  })
  .strict();

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function assertSize(value: string): void {
  const bytes = byteLength(value);
  if (bytes > LIBRARY_LIMITS.maxImportBytes) throw new LibraryImportSizeError(bytes);
}

function assertSafeKeys(value: unknown, seen = new Set<object>()): void {
  if (typeof value !== "object" || value === null || seen.has(value)) return;
  seen.add(value);
  for (const key of Object.keys(value)) {
    if (DANGEROUS_OBJECT_KEYS.has(key)) throw new UnsafeImportKeyError(key);
    assertSafeKeys((value as Record<string, unknown>)[key], seen);
  }
}

export function serializeLibraryExport(
  stateValue: LibraryState,
  appVersion: string,
  now: Date = new Date(),
): string {
  const envelope = exportEnvelopeSchema.parse({
    format: "jacobe-skills",
    schemaVersion: SCHEMA_VERSION,
    appVersion,
    exportedAt: now.toISOString(),
    data: libraryStateSchema.parse(stateValue),
  });
  const serialized = JSON.stringify(envelope, null, 2);
  assertSize(serialized);
  return serialized;
}

export function parseLibraryImport(raw: string): LibraryState {
  assertSize(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new LibraryImportError("Import is not valid JSON.", { cause: error });
  }

  assertSafeKeys(parsed);
  if (typeof parsed !== "object" || parsed === null) {
    throw new LibraryImportError("Import must be a JacobeAPI export object.");
  }
  const version = (parsed as { schemaVersion?: unknown }).schemaVersion;
  if (version !== SCHEMA_VERSION) throw new UnsupportedSchemaVersionError(version);

  let envelope: ExportEnvelope;
  try {
    envelope = exportEnvelopeSchema.parse(parsed);
  } catch (error) {
    throw new LibraryImportError("Import does not match the JacobeAPI format.", { cause: error });
  }
  if (envelope.data.schemaVersion !== envelope.schemaVersion) {
    throw new LibraryImportError("Envelope and library schema versions do not match.");
  }
  return migrateLibraryState(envelope.data);
}

function mergeCards<T extends Skill | McpTool>(
  current: readonly T[],
  incoming: readonly T[],
  strategy: Exclude<ImportStrategy, "replace">,
): { cards: T[]; preview: ImportKindPreview; conflicts: string[] } {
  const incomingById = new Map(incoming.map((card) => [card.id, card]));
  const currentById = new Map(current.map((card) => [card.id, card]));
  const conflicts = incoming.filter((card) => currentById.has(card.id)).map((card) => card.id);
  const added = incoming.length - conflicts.length;

  if (strategy === "skip") {
    return {
      cards: [...current, ...incoming.filter((card) => !currentById.has(card.id))],
      preview: { incoming: incoming.length, added, overwritten: 0, skipped: conflicts.length, removed: 0 },
      conflicts,
    };
  }

  return {
    cards: [
      ...current.map((card) => incomingById.get(card.id) ?? card),
      ...incoming.filter((card) => !currentById.has(card.id)),
    ],
    preview: { incoming: incoming.length, added, overwritten: conflicts.length, skipped: 0, removed: 0 },
    conflicts,
  };
}

function replacePreview<T extends Skill | McpTool>(current: readonly T[], incoming: readonly T[]): ImportKindPreview {
  const currentIds = new Set(current.map(({ id }) => id));
  const incomingIds = new Set(incoming.map(({ id }) => id));
  const overwritten = incoming.filter(({ id }) => currentIds.has(id)).length;
  return {
    incoming: incoming.length,
    added: incoming.length - overwritten,
    overwritten,
    skipped: 0,
    removed: current.filter(({ id }) => !incomingIds.has(id)).length,
  };
}

function assertNoCrossKindConflicts(current: LibraryState, incoming: LibraryState): void {
  const currentSkillIds = new Set(current.skills.map(({ id }) => id));
  const currentMcpIds = new Set(current.mcps.map(({ id }) => id));
  for (const skill of incoming.skills) {
    if (currentMcpIds.has(skill.id)) throw new LibraryImportError(`Card id changes kind during import: ${skill.id}`);
  }
  for (const mcp of incoming.mcps) {
    if (currentSkillIds.has(mcp.id)) throw new LibraryImportError(`Card id changes kind during import: ${mcp.id}`);
  }
}

export function previewLibraryImport(
  currentValue: LibraryState,
  incomingValue: LibraryState,
  strategy: ImportStrategy,
): ImportPreview {
  const current = libraryStateSchema.parse(currentValue);
  const incoming = libraryStateSchema.parse(incomingValue);
  assertNoCrossKindConflicts(current, incoming);

  if (strategy === "replace") {
    const candidate = libraryStateSchema.parse({ ...incoming, revision: current.revision });
    return {
      strategy,
      skills: replacePreview(current.skills, incoming.skills),
      mcps: replacePreview(current.mcps, incoming.mcps),
      totalCards: candidate.skills.length + candidate.mcps.length,
      conflicts: [],
      candidate,
    };
  }

  const skills = mergeCards(current.skills, incoming.skills, strategy);
  const mcps = mergeCards(current.mcps, incoming.mcps, strategy);
  const candidate = libraryStateSchema.parse({
    ...current,
    skills: skills.cards,
    mcps: mcps.cards,
    revision: current.revision,
  });
  return {
    strategy,
    skills: skills.preview,
    mcps: mcps.preview,
    totalCards: candidate.skills.length + candidate.mcps.length,
    conflicts: [...skills.conflicts, ...mcps.conflicts],
    candidate,
  };
}

export function prepareLibraryImport(
  raw: string,
  current: LibraryState,
  strategy: ImportStrategy,
): ImportPreview {
  return previewLibraryImport(current, parseLibraryImport(raw), strategy);
}
