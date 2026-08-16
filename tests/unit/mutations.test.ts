import { describe, expect, it } from "vitest";

import { InvalidLibraryMutationError, applyMutation } from "../../src/domain/mutations";
import { makeSkill, makeState } from "./fixtures";

describe("applyMutation", () => {
  it("is pure and increments the revision", () => {
    const current = makeState();
    const snapshot = structuredClone(current);
    const next = applyMutation(current, { type: "toggle-favorite", kind: "skill", id: current.skills[0].id });

    expect(current).toEqual(snapshot);
    expect(next).not.toBe(current);
    expect(next.skills[0].favorite).toBe(true);
    expect(next.revision).toBe(1);
  });

  it("upserts a normalized skill", () => {
    const next = applyMutation(makeState(), {
      type: "upsert-skill",
      skill: makeSkill({
        id: "33333333-3333-4333-8333-333333333333",
        title: "  New skill  ",
        tags: ["Work", "ｗｏｒｋ"],
      }),
    });
    expect(next.skills).toHaveLength(2);
    expect(next.skills[1]).toMatchObject({ title: "New skill", tags: ["Work"] });
  });

  it("rejects missing cards and cross-kind ids", () => {
    const current = makeState();
    expect(() =>
      applyMutation(current, {
        type: "delete-card",
        kind: "skill",
        id: "44444444-4444-4444-8444-444444444444",
      }),
    ).toThrow(InvalidLibraryMutationError);
    expect(() =>
      applyMutation(current, { type: "upsert-skill", skill: makeSkill({ id: current.mcps[0].id }) }),
    ).toThrow(InvalidLibraryMutationError);
  });

  it("keeps the local revision when importing and advances it once", () => {
    const current = makeState({ revision: 8 });
    const imported = makeState({ revision: 99, skills: [] });
    const next = applyMutation(current, { type: "import-state", state: imported });
    expect(next.revision).toBe(9);
    expect(next.skills).toEqual([]);
  });
});

