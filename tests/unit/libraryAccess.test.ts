import { describe, expect, it } from "vitest";
import type { AccountSessionState } from "../../src/domain/account";
import type { LibraryState, Skill } from "../../src/domain/types";
import {
  decideCreateAccess,
  decideImportAccess,
  decideUpsertAccess,
  isLimitExceededError,
  platformErrorMessage,
  type LibraryAccessContext,
} from "../../src/services/libraryAccess";
import { makeSkill, makeState } from "./fixtures";

const signedOut: AccountSessionState = { status: "ready", session: { status: "signedOut", source: "mock" } };
const signedIn: AccountSessionState = {
  status: "ready",
  session: { status: "signedIn", source: "live", user: { id: "user", displayName: "User" } },
};

function context(sessionState: AccountSessionState = signedOut, platformKind: LibraryAccessContext["platformKind"] = "desktop"): LibraryAccessContext {
  return { platformKind, accountAvailable: platformKind === "desktop", sessionState };
}

function skills(count: number): Skill[] {
  return Array.from({ length: count }, (_, index) => makeSkill({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    title: `Skill ${index + 1}`,
  }));
}

function stateWithSkills(count: number): LibraryState {
  return makeState({ skills: skills(count), mcps: [] });
}

describe("desktop library access", () => {
  it("allows a guest up to three cards of each kind and then asks for sign-in", () => {
    expect(decideCreateAccess(context(), stateWithSkills(2), "skill").allowed).toBe(true);
    const blocked = decideCreateAccess(context(), stateWithSkills(3), "skill");
    expect(blocked).toMatchObject({ allowed: false, kind: "skill" });
    expect(blocked.reason).toContain("最多保存 3 个 Skill");
  });

  it("does not limit signed-in desktop users or account-less extension users", () => {
    expect(decideCreateAccess(context(signedIn), stateWithSkills(3), "skill").allowed).toBe(true);
    expect(decideCreateAccess(context({ status: "unavailable" }, "extension"), stateWithSkills(3), "skill").allowed).toBe(true);
  });

  it("allows editing an existing card even when a guest library is already over quota", () => {
    const state = stateWithSkills(5);
    expect(decideUpsertAccess(context(), state, { ...state.skills[0], title: "Edited" }).allowed).toBe(true);
    expect(decideUpsertAccess(context(), state, makeSkill({ id: "99999999-9999-4999-8999-999999999999" })).allowed).toBe(false);
  });

  it("blocks import growth but permits overwrite, reduction, and grandfathered counts", () => {
    expect(decideImportAccess(context(), stateWithSkills(3), stateWithSkills(4)).allowed).toBe(false);
    expect(decideImportAccess(context(), stateWithSkills(3), stateWithSkills(3)).allowed).toBe(true);
    expect(decideImportAccess(context(), stateWithSkills(5), stateWithSkills(5)).allowed).toBe(true);
    expect(decideImportAccess(context(), stateWithSkills(5), stateWithSkills(6)).allowed).toBe(false);
    expect(decideImportAccess(context(), stateWithSkills(5), stateWithSkills(2)).allowed).toBe(true);
  });

  it("reads structured and stringified backend errors without exposing raw JSON", () => {
    const structured = { code: "LIMIT_EXCEEDED", message: "访客额度已用完", limit: 3 };
    const stringified = JSON.stringify(structured);
    expect(isLimitExceededError(structured)).toBe(true);
    expect(isLimitExceededError(stringified)).toBe(true);
    expect(platformErrorMessage(stringified, "fallback")).toBe("访客额度已用完");
  });
});
