import { libraryMutationSchema, libraryStateSchema } from "./schema";
import type { CardEntity, LibraryMutation, LibraryState, McpTool, Skill } from "./types";

export class InvalidLibraryMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidLibraryMutationError";
  }
}

function upsert<T extends CardEntity>(cards: T[], card: T): T[] {
  const index = cards.findIndex(({ id }) => id === card.id);
  if (index === -1) return [...cards, card];
  return cards.map((current, currentIndex) => (currentIndex === index ? card : current));
}

function assertIdAvailableInOtherCollection(state: LibraryState, card: CardEntity): void {
  const otherCards = card.kind === "skill" ? state.mcps : state.skills;
  if (otherCards.some(({ id }) => id === card.id)) {
    throw new InvalidLibraryMutationError(`Card id ${card.id} is already used by another card kind`);
  }
}

function toggleFavorite<T extends CardEntity>(cards: T[], id: string): T[] {
  let found = false;
  const next = cards.map((card) => {
    if (card.id !== id) return card;
    found = true;
    return { ...card, favorite: !card.favorite };
  });
  if (!found) throw new InvalidLibraryMutationError(`Card not found: ${id}`);
  return next;
}

function deleteCard<T extends CardEntity>(cards: T[], id: string): T[] {
  const next = cards.filter((card) => card.id !== id);
  if (next.length === cards.length) throw new InvalidLibraryMutationError(`Card not found: ${id}`);
  return next;
}

export function applyMutation(currentValue: LibraryState, mutationValue: LibraryMutation): LibraryState {
  const current = libraryStateSchema.parse(currentValue);
  const mutation = libraryMutationSchema.parse(mutationValue);
  let next: LibraryState;

  switch (mutation.type) {
    case "upsert-skill":
      assertIdAvailableInOtherCollection(current, mutation.skill);
      next = { ...current, skills: upsert<Skill>(current.skills, mutation.skill) };
      break;
    case "upsert-mcp":
      assertIdAvailableInOtherCollection(current, mutation.mcp);
      next = { ...current, mcps: upsert<McpTool>(current.mcps, mutation.mcp) };
      break;
    case "delete-card":
      next =
        mutation.kind === "skill"
          ? { ...current, skills: deleteCard(current.skills, mutation.id) }
          : { ...current, mcps: deleteCard(current.mcps, mutation.id) };
      break;
    case "toggle-favorite":
      next =
        mutation.kind === "skill"
          ? { ...current, skills: toggleFavorite(current.skills, mutation.id) }
          : { ...current, mcps: toggleFavorite(current.mcps, mutation.id) };
      break;
    case "set-preferences":
      next = { ...current, preferences: { ...current.preferences, ...mutation.preferences } };
      break;
    case "import-state":
      next = { ...mutation.state, revision: current.revision };
      break;
  }

  return libraryStateSchema.parse({ ...next, revision: current.revision + 1 });
}

