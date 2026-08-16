export const LIBRARY_LIMITS = {
  maxImportBytes: 4 * 1024 * 1024,
  maxSlotBytes: 4 * 1024 * 1024,
  maxCards: 2_000,
  maxTitleLength: 120,
  maxDescriptionLength: 600,
  maxContentLength: 100 * 1024,
  maxTagLength: 32,
  maxTagsPerCard: 20,
  maxArgsPerMcp: 50,
  maxEnvEntriesPerMcp: 50,
} as const;
