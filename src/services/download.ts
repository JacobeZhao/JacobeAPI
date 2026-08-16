import type { ExportEnvelope, LibraryState, Skill } from "../domain/types";
import { safeFilename } from "./filename";

export function downloadTextFile(content: string, filename: string, mimeType = "text/plain;charset=utf-8"): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadSkillMarkdown(skill: Skill): void {
  downloadTextFile(
    serializeSkillMarkdown(skill),
    safeFilename(skill.title, "md", "skill"),
    "text/markdown;charset=utf-8",
  );
}

export function serializeSkillMarkdown(skill: Skill): string {
  const tags = skill.tags.length ? `\n\n标签：${skill.tags.join("、")}` : "";
  const notes = skill.installNotes ? `\n\n## 安装说明\n\n${skill.installNotes}` : "";
  return `# ${skill.title}\n\n${skill.description}\n\n## 提示词\n\n${skill.prompt}${notes}${tags}\n`;
}

export function downloadLibraryJson(content: string | LibraryState | ExportEnvelope): void {
  const serialized = typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`;
  downloadTextFile(serialized, `jacobeapi-${new Date().toISOString().slice(0, 10)}.json`, "application/json;charset=utf-8");
}
