import { createDefaultLibraryState } from "../domain/defaults";
import type {
  LibraryMutation,
  LibraryState,
  RuntimeRequest,
  RuntimeResponse,
  StateUpdatedMessage,
} from "../domain/types";

const DEV_STORAGE_KEY = "jacobe-skills:dev-library";
const devListeners = new Set<(state: LibraryState) => void>();

export class LibraryRuntimeError extends Error {
  constructor(
    public readonly code: "CONFLICT" | "INVALID" | "STORAGE" | "UNKNOWN",
    message: string,
    public readonly state?: LibraryState,
  ) {
    super(message);
    this.name = "LibraryRuntimeError";
  }
}

function usesExtensionRuntime(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
}

function cloneState(state: LibraryState): LibraryState {
  return structuredClone(state);
}

function readDevState(): LibraryState {
  try {
    const saved = localStorage.getItem(DEV_STORAGE_KEY);
    return saved ? (JSON.parse(saved) as LibraryState) : createDefaultLibraryState();
  } catch {
    return createDefaultLibraryState();
  }
}

function writeDevState(state: LibraryState): void {
  localStorage.setItem(DEV_STORAGE_KEY, JSON.stringify(state));
  const snapshot = cloneState(state);
  devListeners.forEach((listener) => listener(snapshot));
}

function applyDevMutation(state: LibraryState, mutation: LibraryMutation): LibraryState {
  const next = cloneState(state);

  switch (mutation.type) {
    case "upsert-skill": {
      const index = next.skills.findIndex((skill) => skill.id === mutation.skill.id);
      if (index === -1) next.skills.push(structuredClone(mutation.skill));
      else next.skills[index] = structuredClone(mutation.skill);
      break;
    }
    case "upsert-mcp": {
      const index = next.mcps.findIndex((mcp) => mcp.id === mutation.mcp.id);
      if (index === -1) next.mcps.push(structuredClone(mutation.mcp));
      else next.mcps[index] = structuredClone(mutation.mcp);
      break;
    }
    case "delete-card":
      if (mutation.kind === "skill") next.skills = next.skills.filter(({ id }) => id !== mutation.id);
      else next.mcps = next.mcps.filter(({ id }) => id !== mutation.id);
      break;
    case "toggle-favorite": {
      const entities = mutation.kind === "skill" ? next.skills : next.mcps;
      const entity = entities.find(({ id }) => id === mutation.id);
      if (entity) {
        entity.favorite = !entity.favorite;
        entity.updatedAt = new Date().toISOString();
      }
      break;
    }
    case "set-preferences":
      next.preferences = { ...next.preferences, ...mutation.preferences };
      break;
    case "import-state":
      return { ...cloneState(mutation.state), revision: state.revision + 1 };
  }

  next.revision = state.revision + 1;
  return next;
}

async function send(request: RuntimeRequest): Promise<RuntimeResponse> {
  const response = await chrome.runtime.sendMessage<RuntimeRequest, RuntimeResponse>(request);
  if (!response) throw new LibraryRuntimeError("UNKNOWN", "扩展后台没有响应，请重试。");
  return response;
}

function unwrapState(response: RuntimeResponse): LibraryState {
  if (!response.ok) throw new LibraryRuntimeError(response.code, response.message, response.state);
  if (!response.state) throw new LibraryRuntimeError("UNKNOWN", "响应中缺少资料库数据。");
  return response.state;
}

export async function getLibrary(): Promise<LibraryState> {
  if (!usesExtensionRuntime()) return cloneState(readDevState());
  return unwrapState(await send({ type: "GET_LIBRARY" }));
}

export async function mutateLibrary(
  mutation: LibraryMutation,
  baseRevision: number,
): Promise<LibraryState> {
  if (!usesExtensionRuntime()) {
    const current = readDevState();
    if (current.revision !== baseRevision) {
      throw new LibraryRuntimeError("CONFLICT", "资料库已在其他页面更新，请刷新后重试。", current);
    }
    const next = applyDevMutation(current, mutation);
    writeDevState(next);
    return cloneState(next);
  }

  return unwrapState(
    await send({
      type: "MUTATE_LIBRARY",
      requestId: crypto.randomUUID(),
      baseRevision,
      mutation,
    }),
  );
}

export async function openManager(): Promise<void> {
  if (!usesExtensionRuntime()) {
    window.open("/", "_blank", "noopener,noreferrer");
    return;
  }
  const response = await send({ type: "OPEN_MANAGER" });
  if (!response.ok) throw new LibraryRuntimeError(response.code, response.message, response.state);
}

export function subscribeLibrary(listener: (state: LibraryState) => void): () => void {
  if (usesExtensionRuntime()) {
    const handleMessage = (message: unknown) => {
      const update = message as Partial<StateUpdatedMessage>;
      if (update.type === "STATE_UPDATED" && update.state) listener(cloneState(update.state));
    };
    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === DEV_STORAGE_KEY && event.newValue) {
      try {
        listener(JSON.parse(event.newValue) as LibraryState);
      } catch {
        // Ignore malformed external preview data; getLibrary() will restore defaults.
      }
    }
  };
  devListeners.add(listener);
  window.addEventListener("storage", handleStorage);
  return () => {
    devListeners.delete(listener);
    window.removeEventListener("storage", handleStorage);
  };
}
