import { describe, expect, it } from "vitest";

import { filterCards, getAllTags, searchCards } from "../../src/services/search";
import { makeMcp, makeSkill } from "./fixtures";

describe("card search", () => {
  const cards = [
    makeSkill({ title: "写作助手", prompt: "把复杂内容讲清楚", tags: ["写作", "新手"] }),
    makeSkill({
      id: "33333333-3333-4333-8333-333333333333",
      title: "Code review",
      prompt: "Find regressions",
      tags: ["Development"],
    }),
    makeMcp({ tags: ["Files", "Development"] }),
  ];

  it("searches title, description, body, tags, and MCP fields", () => {
    expect(searchCards(cards, { query: "复杂内容" })).toEqual([cards[0]]);
    expect(filterCards(cards, { query: "root_path" })).toEqual([cards[2]]);
    expect(filterCards(cards, { query: "ｃｏｄｅ" })).toEqual([cards[1]]);
  });

  it("uses OR within selected tags and AND between search and tags", () => {
    expect(filterCards(cards, { tags: ["写作", "development"] })).toEqual(cards);
    expect(filterCards(cards, { query: "regressions", tags: ["Files"] })).toEqual([]);
    expect(filterCards(cards, { query: "regressions", tags: ["Development"] })).toEqual([cards[1]]);
  });

  it("returns normalized unique tags", () => {
    const withDuplicate = [...cards, makeSkill({ id: "44444444-4444-4444-8444-444444444444", tags: ["ｆｉｌｅｓ"] })];
    expect(getAllTags(withDuplicate).filter((tag) => tag.toLowerCase() === "files")).toEqual(["Files"]);
  });
});

