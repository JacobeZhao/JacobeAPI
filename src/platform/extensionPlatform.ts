import { copyText } from "../services/clipboard";
import { downloadTextFile } from "../services/download";
import { getLibrary, mutateLibrary, openManager, subscribeLibrary } from "../runtime/client";
import type { PlatformServices, SaveTextFileRequest, SelectedTextFile } from "./contracts";

function pickJsonFile(): Promise<SelectedTextFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json,.json";

    const finish = (result: SelectedTextFile | null) => {
      input.remove();
      resolve(result);
    };
    input.addEventListener("cancel", () => finish(null), { once: true });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      void file.text()
        .then((text) => finish({ name: file.name, text }))
        .catch(() => finish(null));
    }, { once: true });
    input.click();
  });
}

function saveTextFile({ content, defaultName, extension }: SaveTextFileRequest): Promise<"saved"> {
  const mimeType = extension === "json" ? "application/json;charset=utf-8" : "text/markdown;charset=utf-8";
  downloadTextFile(content, defaultName, mimeType);
  return Promise.resolve("saved");
}

export const extensionPlatform: PlatformServices = {
  kind: "extension",
  library: { getLibrary, mutateLibrary, subscribeLibrary, openManager },
  copyText,
  pickJsonFile,
  saveTextFile,
};
