import { libraryStateSchema } from "./schema";
import { SCHEMA_VERSION, type LibraryState } from "./types";

export class UnsupportedSchemaVersionError extends Error {
  constructor(readonly version: unknown) {
    super(`Unsupported library schema version: ${String(version)}`);
    this.name = "UnsupportedSchemaVersionError";
  }
}

export function migrateLibraryState(value: unknown): LibraryState {
  if (typeof value !== "object" || value === null || !("schemaVersion" in value)) {
    throw new UnsupportedSchemaVersionError(undefined);
  }

  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  if (version !== SCHEMA_VERSION) {
    throw new UnsupportedSchemaVersionError(version);
  }

  return libraryStateSchema.parse(value);
}

