import { useMemo, useState } from "react";
import { LIBRARY_LIMITS } from "../../domain/limits";
import type { CardEntity, McpTool, Skill } from "../../domain/types";

interface EntityEditorProps {
  kind: CardEntity["kind"];
  entity?: CardEntity | null;
  onCancel: () => void;
  onSave: (entity: CardEntity) => Promise<void> | void;
}

interface EditorValues {
  title: string;
  description: string;
  tags: string;
  prompt: string;
  installNotes: string;
  serverName: string;
  command: string;
  args: string;
  env: string;
}

const emptyValues: EditorValues = {
  title: "",
  description: "",
  tags: "",
  prompt: "",
  installNotes: "",
  serverName: "",
  command: "",
  args: "",
  env: "",
};

function valuesFromEntity(entity?: CardEntity | null): EditorValues {
  if (!entity) return emptyValues;
  const shared = { title: entity.title, description: entity.description, tags: entity.tags.join(", ") };
  if (entity.kind === "skill") {
    return { ...emptyValues, ...shared, prompt: entity.prompt, installNotes: entity.installNotes };
  }
  return {
    ...emptyValues,
    ...shared,
    serverName: entity.serverName,
    command: entity.command,
    args: entity.args.join("\n"),
    env: Object.entries(entity.env).map(([key, value]) => `${key}=${value}`).join("\n"),
  };
}

function parseTags(value: string) {
  return [...new Set(value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))];
}

function parseEnv(value: string): { env: Record<string, string>; error?: string } {
  const env: Record<string, string> = {};
  for (const line of value.split("\n").map((item) => item.trim()).filter(Boolean)) {
    const separator = line.indexOf("=");
    if (separator < 1) return { env, error: `“${line}” 应写成 KEY=VALUE` };
    const key = line.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) return { env, error: `“${key}” 不是有效的环境变量名` };
    env[key] = line.slice(separator + 1);
  }
  return { env };
}

export function EntityEditor({ kind, entity, onCancel, onSave }: EntityEditorProps) {
  const [values, setValues] = useState(() => valuesFromEntity(entity));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const isSkill = kind === "skill";
  const tags = useMemo(() => parseTags(values.tags), [values.tags]);

  const update = (field: keyof EditorValues, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (!values.title.trim()) nextErrors.title = "请输入名称";
    if (values.title.trim().length > LIBRARY_LIMITS.maxTitleLength) nextErrors.title = `名称不能超过 ${LIBRARY_LIMITS.maxTitleLength} 个字符`;
    if (values.description.length > LIBRARY_LIMITS.maxDescriptionLength) nextErrors.description = `说明不能超过 ${LIBRARY_LIMITS.maxDescriptionLength} 个字符`;
    if (tags.length > LIBRARY_LIMITS.maxTagsPerCard) nextErrors.tags = `最多添加 ${LIBRARY_LIMITS.maxTagsPerCard} 个标签`;
    if (tags.some((tag) => tag.length > LIBRARY_LIMITS.maxTagLength)) nextErrors.tags = `每个标签不能超过 ${LIBRARY_LIMITS.maxTagLength} 个字符`;
    if (isSkill && !values.prompt.trim()) nextErrors.prompt = "请输入提示词";
    if (isSkill && values.prompt.length > LIBRARY_LIMITS.maxContentLength) nextErrors.prompt = "提示词内容过长";
    if (!isSkill && !values.serverName.trim()) nextErrors.serverName = "请输入服务器名称";
    if (!isSkill && !values.command.trim()) nextErrors.command = "请输入启动命令";
    const args = values.args.split("\n").map((line) => line.trim()).filter(Boolean);
    if (args.length > LIBRARY_LIMITS.maxArgsPerMcp) nextErrors.args = `最多填写 ${LIBRARY_LIMITS.maxArgsPerMcp} 个参数`;
    const parsedEnv = parseEnv(values.env);
    if (parsedEnv.error) nextErrors.env = parsedEnv.error;
    if (Object.keys(parsedEnv.env).length > LIBRARY_LIMITS.maxEnvEntriesPerMcp) nextErrors.env = `最多填写 ${LIBRARY_LIMITS.maxEnvEntriesPerMcp} 个环境变量`;
    setErrors(nextErrors);
    if (Object.values(nextErrors).some(Boolean)) return;

    const now = new Date().toISOString();
    const shared = {
      id: entity?.id ?? crypto.randomUUID(),
      title: values.title.trim(),
      description: values.description.trim(),
      tags,
      favorite: entity?.favorite ?? false,
      createdAt: entity?.createdAt ?? now,
      updatedAt: now,
    };
    const nextEntity: Skill | McpTool = isSkill
      ? { ...shared, kind: "skill", prompt: values.prompt.trim(), installNotes: values.installNotes.trim() }
      : { ...shared, kind: "mcp", serverName: values.serverName.trim(), command: values.command.trim(), args, env: parsedEnv.env };

    setSaving(true);
    try {
      await onSave(nextEntity);
    } finally {
      setSaving(false);
    }
  };

  const field = (name: keyof EditorValues, label: string, options?: { textarea?: boolean; required?: boolean; hint?: string; rows?: number }) => {
    const id = `editor-${name}`;
    const error = errors[name];
    const inputProps = {
      id,
      value: values[name],
      required: options?.required,
      "aria-invalid": Boolean(error),
      "aria-describedby": error ? `${id}-error` : options?.hint ? `${id}-hint` : undefined,
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => update(name, event.target.value),
    };
    return (
      <label className={`form-field ${options?.textarea ? "form-field--wide" : ""}`} htmlFor={id}>
        <span>{label}{options?.required ? <b aria-hidden="true"> *</b> : null}</span>
        {options?.textarea ? <textarea {...inputProps} rows={options.rows ?? 4} /> : <input {...inputProps} />}
        {error ? <small className="field-error" id={`${id}-error`}>{error}</small> : options?.hint ? <small className="field-hint" id={`${id}-hint`}>{options.hint}</small> : null}
      </label>
    );
  };

  return (
    <form className="entity-form" onSubmit={submit} noValidate>
      <div className="form-grid">
        {field("title", isSkill ? "Skill 名称" : "工具名称", { required: true })}
        {field("tags", "标签", { hint: "用逗号分隔，例如：写作, 效率" })}
        {field("description", "简短说明", { textarea: true, rows: 3 })}
        {isSkill ? (
          <>
            {field("prompt", "提示词", { textarea: true, required: true, rows: 11, hint: "复制时会使用这里的完整内容" })}
            {field("installNotes", "使用说明", { textarea: true, rows: 4, hint: "可选：告诉自己如何使用或安装" })}
          </>
        ) : (
          <>
            {field("serverName", "服务器名称", { required: true, hint: "配置文件中的唯一名称，例如 filesystem" })}
            {field("command", "启动命令", { required: true, hint: "例如 npx、uvx 或 node" })}
            {field("args", "命令参数", { textarea: true, rows: 5, hint: "每行一个参数，可避免空格和引号混淆" })}
            {field("env", "环境变量", { textarea: true, rows: 5, hint: "每行一项，格式为 KEY=VALUE；请谨慎保存密钥" })}
          </>
        )}
      </div>
      <footer className="drawer-actions">
        <button type="button" className="button button--ghost" onClick={onCancel}>取消</button>
        <button type="submit" className="button button--primary" disabled={saving}>{saving ? "正在保存…" : entity ? "保存修改" : "创建"}</button>
      </footer>
    </form>
  );
}
