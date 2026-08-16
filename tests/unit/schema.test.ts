import { describe, expect, it } from "vitest";

import { libraryStateSchema, mcpToolSchema, skillSchema } from "../../src/domain/schema";
import { makeMcp, makeSkill, makeState } from "./fixtures";

describe("strict domain schemas", () => {
  it("normalizes and deduplicates tags without losing first display casing", () => {
    const parsed = skillSchema.parse(
      makeSkill({ tags: ["  Writing  ", "ｗｒｉｔｉｎｇ", "效率", " 效率 "] }),
    );
    expect(parsed.tags).toEqual(["Writing", "效率"]);
  });

  it("rejects unknown fields", () => {
    expect(() => skillSchema.parse({ ...makeSkill(), remoteCode: "alert(1)" })).toThrow();
    expect(() => libraryStateSchema.parse({ ...makeState(), unknown: true })).toThrow();
  });

  it("rejects unsafe MCP environment keys", () => {
    const env = JSON.parse('{"constructor":"bad"}') as Record<string, string>;
    expect(() => mcpToolSchema.parse(makeMcp({ env }))).toThrow(/Unsafe object key/);
  });

  it.each(["__proto__", "prototype", "constructor", "CONSTRUCTOR"])(
    "rejects unsafe MCP server name %s",
    (serverName) => {
      expect(() => mcpToolSchema.parse(makeMcp({ serverName }))).toThrow(/Unsafe MCP server name/);
    },
  );

  it("requires globally unique card ids", () => {
    const skill = makeSkill();
    expect(() => libraryStateSchema.parse(makeState({ mcps: [makeMcp({ id: skill.id })] }))).toThrow(
      /Duplicate card id/,
    );
  });
});
