import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDefaultLibraryState } from "../../src/domain/defaults";
import { getLibrary, LibraryRuntimeError, mutateLibrary, subscribeLibrary } from "../../src/runtime";

describe("development runtime client", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("loads an isolated default library without the Chrome runtime", async () => {
    const state = await getLibrary();
    expect(state.skills).toHaveLength(2);
    expect(state.mcps).toHaveLength(3);

    state.skills.length = 0;
    expect((await getLibrary()).skills).toHaveLength(2);
  });

  it("applies mutations, increments revision, and notifies subscribers", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribeLibrary(listener);
    const initial = await getLibrary();

    const updated = await mutateLibrary(
      { type: "toggle-favorite", kind: "skill", id: initial.skills[1].id },
      initial.revision,
    );

    expect(updated.revision).toBe(initial.revision + 1);
    expect(updated.skills[1].favorite).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    unsubscribe();
  });

  it("rejects a stale base revision without overwriting data", async () => {
    const initial = createDefaultLibraryState();
    await mutateLibrary(
      { type: "set-preferences", preferences: { managerView: "mcps" } },
      initial.revision,
    );

    await expect(mutateLibrary(
      { type: "set-preferences", preferences: { managerView: "skills" } },
      initial.revision,
    )).rejects.toMatchObject({ code: "CONFLICT" } satisfies Partial<LibraryRuntimeError>);
    expect((await getLibrary()).preferences.managerView).toBe("mcps");
  });
});
