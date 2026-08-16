import type { CardEntity, McpTool, Skill } from "../domain/types";

export interface CardFilter {
  query?: string;
  tags?: readonly string[];
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function cardBody(card: CardEntity): string[] {
  if (card.kind === "skill") return [card.prompt, card.installNotes];
  return [card.serverName, card.command, ...card.args, ...Object.keys(card.env), ...Object.values(card.env)];
}

function searchableText(card: CardEntity): string {
  return [card.title, card.description, ...card.tags, ...cardBody(card)].map(normalize).join("\n");
}

export function filterCards<T extends CardEntity>(cards: readonly T[], filter: CardFilter = {}): T[] {
  const query = normalize(filter.query ?? "");
  const selectedTags = new Set((filter.tags ?? []).map(normalize).filter(Boolean));

  return cards.filter((card) => {
    const queryMatches = query.length === 0 || searchableText(card).includes(query);
    const cardTags = new Set(card.tags.map(normalize));
    const tagMatches = selectedTags.size === 0 || [...selectedTags].some((tag) => cardTags.has(tag));
    return queryMatches && tagMatches;
  });
}

export const searchCards = filterCards;

export function getAllTags(cards: readonly CardEntity[]): string[] {
  const tags = new Map<string, string>();
  for (const card of cards) {
    for (const tag of card.tags) {
      const displayValue = tag.normalize("NFKC").trim();
      const key = normalize(displayValue);
      if (key && !tags.has(key)) tags.set(key, displayValue);
    }
  }
  return [...tags.values()].sort((left, right) => left.localeCompare(right));
}

export function filterSkills(skills: readonly Skill[], filter: CardFilter = {}): Skill[] {
  return filterCards(skills, filter);
}

export function filterMcps(mcps: readonly McpTool[], filter: CardFilter = {}): McpTool[] {
  return filterCards(mcps, filter);
}
