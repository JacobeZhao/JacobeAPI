import type { AccountSessionState } from "../domain/account";
import type { CardEntity, LibraryState } from "../domain/types";
import type { PlatformKind } from "../platform/contracts";

export const DESKTOP_GUEST_KIND_LIMIT = 3;

export interface LibraryAccessContext {
  platformKind: PlatformKind;
  accountAvailable: boolean;
  sessionState: AccountSessionState;
}

export interface LibraryAccessDecision {
  allowed: boolean;
  reason?: string;
  kind?: CardEntity["kind"];
}

function parsedErrorString(value: string): { code?: string; message?: string } | undefined {
  try {
    const parsed = JSON.parse(value) as { code?: unknown; message?: unknown };
    return {
      code: typeof parsed.code === "string" ? parsed.code : undefined,
      message: typeof parsed.message === "string" ? parsed.message : undefined,
    };
  } catch {
    return undefined;
  }
}

export function platformErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === "string" && error.trim()) return parsedErrorString(error)?.message ?? error;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string" && error.message.trim()) {
    return parsedErrorString(error.message)?.message ?? error.message;
  }
  return fallback;
}

export function platformErrorCode(error: unknown): string | undefined {
  if (typeof error === "object" && error && "code" in error && typeof error.code === "string") return error.code;
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") return parsedErrorString(error.message)?.code;
  if (typeof error === "string") return parsedErrorString(error)?.code;
  return undefined;
}

export function isLimitExceededError(error: unknown): boolean {
  return platformErrorCode(error) === "LIMIT_EXCEEDED";
}

export function isDesktopGuest(context: LibraryAccessContext): boolean {
  if (context.platformKind !== "desktop" || !context.accountAvailable) return false;
  return context.sessionState.status !== "ready" || context.sessionState.session.status !== "signedIn";
}

function kindName(kind: CardEntity["kind"]): string {
  return kind === "skill" ? "Skill" : "MCP";
}

function kindCount(state: LibraryState, kind: CardEntity["kind"]): number {
  return kind === "skill" ? state.skills.length : state.mcps.length;
}

export function decideCreateAccess(
  context: LibraryAccessContext,
  state: LibraryState,
  kind: CardEntity["kind"],
): LibraryAccessDecision {
  if (!isDesktopGuest(context) || kindCount(state, kind) < DESKTOP_GUEST_KIND_LIMIT) return { allowed: true };
  return {
    allowed: false,
    kind,
    reason: `未登录最多保存 ${DESKTOP_GUEST_KIND_LIMIT} 个 ${kindName(kind)}，登录或注册后可继续添加。`,
  };
}

export function decideUpsertAccess(
  context: LibraryAccessContext,
  state: LibraryState,
  entity: CardEntity,
): LibraryAccessDecision {
  const cards = entity.kind === "skill" ? state.skills : state.mcps;
  return cards.some(({ id }) => id === entity.id)
    ? { allowed: true }
    : decideCreateAccess(context, state, entity.kind);
}

export function decideImportAccess(
  context: LibraryAccessContext,
  current: LibraryState,
  candidate: LibraryState,
): LibraryAccessDecision {
  if (!isDesktopGuest(context)) return { allowed: true };
  for (const kind of ["skill", "mcp"] as const) {
    const currentCount = kindCount(current, kind);
    const candidateCount = kindCount(candidate, kind);
    const ceiling = Math.max(DESKTOP_GUEST_KIND_LIMIT, currentCount);
    if (candidateCount > ceiling) {
      return {
        allowed: false,
        kind,
        reason: `导入后将有 ${candidateCount} 个 ${kindName(kind)}。未登录最多保存 ${DESKTOP_GUEST_KIND_LIMIT} 个，登录或注册后可继续导入。`,
      };
    }
  }
  return { allowed: true };
}
