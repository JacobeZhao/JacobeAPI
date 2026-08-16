import { describe, expect, it } from "vitest";

import { LIBRARY_LIMITS } from "../../src/domain/limits";
import { UnsupportedSchemaVersionError } from "../../src/domain/migrations";
import {
  LibraryImportError,
  LibraryImportSizeError,
  UnsafeImportKeyError,
  parseLibraryImport,
  prepareLibraryImport,
  previewLibraryImport,
  serializeLibraryExport,
} from "../../src/services/importExport";
import { makeMcp, makeSkill, makeState } from "./fixtures";

describe("library import and export", () => {
  it("round-trips a strict export envelope", () => {
    const state = makeState({ revision: 4 });
    const raw = serializeLibraryExport(state, "0.1.0", new Date("2026-08-15T12:30:00.000Z"));
    expect(JSON.parse(raw)).toMatchObject({ format: "jacobe-skills", schemaVersion: 1 });
    expect(parseLibraryImport(raw)).toEqual(state);
  });

  it("rejects unknown fields, versions, dangerous keys, and oversized input", () => {
    const valid = JSON.parse(serializeLibraryExport(makeState(), "0.1.0")) as Record<string, unknown>;
    expect(() => parseLibraryImport(JSON.stringify({ ...valid, unexpected: true }))).toThrow(LibraryImportError);
    expect(() => parseLibraryImport(JSON.stringify({ ...valid, schemaVersion: 99 }))).toThrow(
      UnsupportedSchemaVersionError,
    );
    expect(() => parseLibraryImport('{"format":"jacobe-skills","__proto__":{},"schemaVersion":1}')).toThrow(
      UnsafeImportKeyError,
    );
    expect(() => parseLibraryImport(" ".repeat(LIBRARY_LIMITS.maxImportBytes + 1))).toThrow(
      LibraryImportSizeError,
    );
  });

  it("previews skip and overwrite without mutating current state", () => {
    const current = makeState();
    const snapshot = structuredClone(current);
    const incoming = makeState({
      revision: 20,
      skills: [
        makeSkill({ title: "Imported title" }),
        makeSkill({ id: "33333333-3333-4333-8333-333333333333", title: "Added" }),
      ],
      mcps: [],
    });

    const skipped = previewLibraryImport(current, incoming, "skip");
    expect(skipped.skills).toMatchObject({ added: 1, skipped: 1, overwritten: 0 });
    expect(skipped.candidate.skills[0].title).toBe(current.skills[0].title);

    const overwritten = previewLibraryImport(current, incoming, "overwrite");
    expect(overwritten.skills).toMatchObject({ added: 1, skipped: 0, overwritten: 1 });
    expect(overwritten.candidate.skills[0].title).toBe("Imported title");
    expect(current).toEqual(snapshot);
  });

  it("previews replace removals and preserves the current revision", () => {
    const current = makeState({ revision: 7 });
    const incoming = makeState({ skills: [], mcps: [makeMcp({ title: "Replacement" })] });
    const preview = previewLibraryImport(current, incoming, "replace");
    expect(preview.skills.removed).toBe(1);
    expect(preview.mcps.overwritten).toBe(1);
    expect(preview.candidate.revision).toBe(7);
  });

  it("returns a commit-ready candidate from raw JSON", () => {
    const raw = serializeLibraryExport(makeState({ skills: [] }), "0.1.0");
    expect(prepareLibraryImport(raw, makeState(), "replace").candidate.skills).toEqual([]);
  });

  it("rejects ids that change card kind", () => {
    const current = makeState();
    const incoming = makeState({
      skills: [makeSkill({ id: current.mcps[0].id })],
      mcps: [],
    });
    expect(() => previewLibraryImport(current, incoming, "overwrite")).toThrow(/changes kind/);
  });
});
