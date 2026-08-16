import { z } from "zod";

import { LIBRARY_LIMITS } from "./limits";
import {
  SCHEMA_VERSION,
  type LibraryMutation,
  type LibraryState,
  type McpTool,
  type Skill,
} from "./types";

export const DANGEROUS_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);

export function normalizeTag(tag: string): string {
  return tag.normalize("NFKC").trim();
}

function normalizedString(maxLength: number, minimumLength = 0) {
  return z.preprocess(
    (value) => (typeof value === "string" ? value.normalize("NFKC").trim() : value),
    z.string().min(minimumLength).max(maxLength),
  );
}

const tagSchema = normalizedString(LIBRARY_LIMITS.maxTagLength, 1);

const serverNameSchema = normalizedString(LIBRARY_LIMITS.maxTitleLength, 1).refine(
  (value) => !DANGEROUS_OBJECT_KEYS.has(value.toLowerCase()),
  "Unsafe MCP server name",
);

const tagsSchema = z
  .array(tagSchema)
  .max(LIBRARY_LIMITS.maxTagsPerCard)
  .transform((tags) => {
    const seen = new Set<string>();
    return tags.filter((tag) => {
      const key = tag.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  });

const cardBaseShape = {
  id: z.uuid(),
  title: normalizedString(LIBRARY_LIMITS.maxTitleLength, 1),
  description: z.string().max(LIBRARY_LIMITS.maxDescriptionLength),
  tags: tagsSchema,
  favorite: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
};

export const skillSchema: z.ZodType<Skill> = z
  .object({
    ...cardBaseShape,
    kind: z.literal("skill"),
    prompt: z.string().min(1).max(LIBRARY_LIMITS.maxContentLength),
    installNotes: z.string().max(LIBRARY_LIMITS.maxContentLength),
  })
  .strict();

const envSchema = z
  .record(
    z.string().min(1).max(LIBRARY_LIMITS.maxTagLength),
    z.string().max(LIBRARY_LIMITS.maxContentLength),
  )
  .superRefine((env, context) => {
    if (Object.keys(env).length > LIBRARY_LIMITS.maxEnvEntriesPerMcp) {
      context.addIssue({
        code: "custom",
        message: `MCP env cannot contain more than ${LIBRARY_LIMITS.maxEnvEntriesPerMcp} entries`,
      });
    }
    for (const key of Object.keys(env)) {
      if (DANGEROUS_OBJECT_KEYS.has(key)) {
        context.addIssue({ code: "custom", message: `Unsafe object key: ${key}` });
      }
    }
  });

export const mcpToolSchema: z.ZodType<McpTool> = z
  .object({
    ...cardBaseShape,
    kind: z.literal("mcp"),
    serverName: serverNameSchema,
    command: z.string().min(1).max(LIBRARY_LIMITS.maxContentLength),
    args: z.array(z.string().max(LIBRARY_LIMITS.maxContentLength)).max(LIBRARY_LIMITS.maxArgsPerMcp),
    env: envSchema,
  })
  .strict();

export const libraryPreferencesSchema = z
  .object({
    managerView: z.enum(["skills", "mcps"]),
    sort: z.enum(["updated-desc", "title-asc"]),
  })
  .strict();

export const libraryStateSchema: z.ZodType<LibraryState> = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    revision: z.number().int().nonnegative().safe(),
    skills: z.array(skillSchema).max(LIBRARY_LIMITS.maxCards),
    mcps: z.array(mcpToolSchema).max(LIBRARY_LIMITS.maxCards),
    preferences: libraryPreferencesSchema,
  })
  .strict()
  .superRefine((state, context) => {
    if (state.skills.length + state.mcps.length > LIBRARY_LIMITS.maxCards) {
      context.addIssue({
        code: "custom",
        message: `Library cannot contain more than ${LIBRARY_LIMITS.maxCards} cards`,
      });
    }

    const ids = new Set<string>();
    for (const card of [...state.skills, ...state.mcps]) {
      if (ids.has(card.id)) {
        context.addIssue({ code: "custom", message: `Duplicate card id: ${card.id}` });
      }
      ids.add(card.id);
    }
  });

export const libraryMutationSchema: z.ZodType<LibraryMutation> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("upsert-skill"), skill: skillSchema }).strict(),
  z.object({ type: z.literal("upsert-mcp"), mcp: mcpToolSchema }).strict(),
  z
    .object({ type: z.literal("delete-card"), kind: z.enum(["skill", "mcp"]), id: z.uuid() })
    .strict(),
  z
    .object({ type: z.literal("toggle-favorite"), kind: z.enum(["skill", "mcp"]), id: z.uuid() })
    .strict(),
  z.object({ type: z.literal("set-preferences"), preferences: libraryPreferencesSchema.partial() }).strict(),
  z.object({ type: z.literal("import-state"), state: libraryStateSchema }).strict(),
]);
