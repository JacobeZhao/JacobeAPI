import type { RuntimeRequest, RuntimeResponse, StateUpdatedMessage } from "./domain/types";
import {
  commitLibraryMutation,
  LibraryConflictError,
  LibraryStorageCorruptionError,
  LibraryStorageError,
  LibraryStorageLimitError,
  loadLibraryState,
} from "./storage/libraryStorage";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRuntimeRequest(value: unknown): value is RuntimeRequest {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  if (value.type === "GET_LIBRARY" || value.type === "OPEN_MANAGER") return true;
  return value.type === "MUTATE_LIBRARY"
    && typeof value.requestId === "string"
    && Number.isSafeInteger(value.baseRevision)
    && Number(value.baseRevision) >= 0
    && isRecord(value.mutation)
    && typeof value.mutation.type === "string";
}

function errorResponse(error: unknown): RuntimeResponse {
  if (error instanceof LibraryConflictError) {
    return {
      ok: false,
      code: "CONFLICT",
      message: "资料库已在另一个页面更新，请刷新后重试。",
      state: error.currentState,
    };
  }
  if (error instanceof LibraryStorageLimitError) {
    return { ok: false, code: "STORAGE", message: "本地资料库空间不足，请导出备份并清理部分内容。" };
  }
  if (error instanceof LibraryStorageCorruptionError) {
    return { ok: false, code: "STORAGE", message: "本地资料库无法读取，请使用备份恢复。" };
  }
  if (error instanceof LibraryStorageError) {
    return { ok: false, code: "STORAGE", message: "本地资料保存失败，请稍后重试。" };
  }
  if (error instanceof Error && error.name === "ZodError") {
    return { ok: false, code: "INVALID", message: "提交的数据格式不正确，请检查后重试。" };
  }
  return { ok: false, code: "UNKNOWN", message: "操作失败，请稍后重试。" };
}

async function broadcastState(state: Awaited<ReturnType<typeof loadLibraryState>>): Promise<void> {
  const message: StateUpdatedMessage = { type: "STATE_UPDATED", state };
  await chrome.runtime.sendMessage(message).catch(() => undefined);
}

export async function handleRuntimeRequest(message: unknown): Promise<RuntimeResponse> {
  if (!isRuntimeRequest(message)) {
    return { ok: false, code: "INVALID", message: "无法识别的扩展请求。" };
  }

  try {
    switch (message.type) {
      case "GET_LIBRARY":
        return { ok: true, state: await loadLibraryState() };
      case "MUTATE_LIBRARY": {
        const state = await commitLibraryMutation(message.baseRevision, message.mutation);
        await broadcastState(state);
        return { ok: true, state };
      }
      case "OPEN_MANAGER":
        await chrome.runtime.openOptionsPage();
        return { ok: true };
    }
  } catch (error) {
    return errorResponse(error);
  }
}

async function configureExtension(): Promise<void> {
  await Promise.all([
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }),
    chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  ]);
}

chrome.runtime.onInstalled.addListener(() => {
  void configureExtension().catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  void configureExtension().catch(() => undefined);
});

void configureExtension().catch(() => undefined);

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (isRecord(message) && message.type === "STATE_UPDATED") return false;
  void handleRuntimeRequest(message).then(sendResponse);
  return true;
});

