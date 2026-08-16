import { useEffect, useMemo, useState } from "react";
import {
  Copy,
  Download,
  Heart,
  Package,
  RefreshCw,
  Search,
  SquareArrowOutUpRight,
  Star,
  Wrench,
} from "lucide-react";
import { IconButton } from "../components/IconButton";
import { QuickAccountSummary } from "../features/account/QuickAccountSummary";
import { ToastRegion, type ToastMessage } from "../components/ToastRegion";
import brandMark from "../desktop/assets/brand-mark.svg?url";
import type { LibraryState, LibraryView, McpTool, Skill } from "../domain/types";
import { usePlatform } from "../platform/PlatformProvider";
import { safeFilename } from "../services/filename";
import { getMcpInstallInstructions, serializeMcpConfig } from "../services/mcpConfig";

type SidePanelEntity = Skill | McpTool;

function searchableText(entity: SidePanelEntity): string {
  const detail = entity.kind === "skill"
    ? `${entity.prompt} ${entity.installNotes}`
    : `${entity.serverName} ${entity.command} ${entity.args.join(" ")}`;
  return `${entity.title} ${entity.description} ${entity.tags.join(" ")} ${detail}`.toLocaleLowerCase("zh-CN");
}

function CardTags({ tags }: { tags: string[] }) {
  return (
    <div className="side-card__tags" aria-label="标签">
      {tags.map((tag) => <span className="side-tag" key={tag}>{tag}</span>)}
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="side-empty">
      <Search aria-hidden="true" size={25} />
      <strong>{filtered ? "没有匹配的卡片" : "这里还没有内容"}</strong>
      <span>{filtered ? "试试清除搜索或筛选条件" : "前往管理页添加第一个卡片"}</span>
    </div>
  );
}

interface SidePanelCardProps {
  entity: SidePanelEntity;
  onCopy: (value: string, label: string) => void;
  onDownload: (mcp: McpTool) => void;
}

function SidePanelCard({ entity, onCopy, onDownload }: SidePanelCardProps) {
  const isSkill = entity.kind === "skill";
  const detail = isSkill ? entity.prompt : getMcpInstallInstructions(entity);

  return (
    <article className="side-card">
      <div className="side-card__heading">
        <span className={`side-card__kind side-card__kind--${entity.kind}`} aria-hidden="true">
          {isSkill ? <Package size={15} /> : <Wrench size={15} />}
        </span>
        <div className="side-card__title-wrap">
          <h2>{entity.title}</h2>
          {entity.favorite ? <Star className="side-card__favorite" size={15} fill="currentColor" aria-label="已收藏" /> : null}
        </div>
      </div>
      {entity.description ? <p className="side-card__description">{entity.description}</p> : null}
      <CardTags tags={entity.tags} />
      <div className="side-card__preview">
        <span>{isSkill ? "提示词" : "启动命令"}</span>
        <pre>{detail}</pre>
      </div>
      <div className="side-card__actions">
        {isSkill ? (
          <>
            <button type="button" className="side-action side-action--primary" onClick={() => onCopy(entity.prompt, "完整提示词") }>
              <Copy size={15} />复制提示词
            </button>
            {entity.installNotes ? (
              <button type="button" className="side-action" onClick={() => onCopy(entity.installNotes, "安装说明") }>
                <Copy size={15} />安装说明
              </button>
            ) : null}
          </>
        ) : (
          <>
            <button type="button" className="side-action side-action--primary" onClick={() => onCopy(serializeMcpConfig(entity), "MCP 配置") }>
              <Copy size={15} />复制配置
            </button>
            <button type="button" className="side-action" onClick={() => onCopy(detail, "启动命令") }>
              <Copy size={15} />启动命令
            </button>
            <IconButton label={`下载 ${entity.title} 配置`} className="side-download" onClick={() => onDownload(entity)}>
              <Download size={16} />
            </IconButton>
          </>
        )}
      </div>
    </article>
  );
}

export function SidePanelApp() {
  const platform = usePlatform();
  const libraryGateway = platform.library;
  const [library, setLibrary] = useState<LibraryState | null>(null);
  const [view, setView] = useState<LibraryView>("skills");
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [error, setError] = useState("");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const load = async () => {
    setError("");
    try {
      setLibrary(await libraryGateway.getLibrary());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "资料库加载失败，请重试。");
    }
  };

  useEffect(() => {
    let active = true;
    void libraryGateway.getLibrary()
      .then((state) => {
        if (active) setLibrary(state);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "资料库加载失败，请重试。");
      });
    const unsubscribe = libraryGateway.subscribeLibrary((state) => {
      if (active) setLibrary(state);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [libraryGateway]);

  const entities = useMemo<SidePanelEntity[]>(
    () => library ? (view === "skills" ? library.skills : library.mcps) : [],
    [library, view],
  );
  const tags = useMemo(
    () => [...new Set(entities.flatMap((entity) => entity.tags))].sort((a, b) => a.localeCompare(b, "zh-CN")),
    [entities],
  );
  const visibleEntities = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
    return entities
      .filter((entity) => !favoritesOnly || entity.favorite)
      .filter((entity) => selectedTags.length === 0 || entity.tags.some((tag) => selectedTags.includes(tag)))
      .filter((entity) => !normalizedQuery || searchableText(entity).includes(normalizedQuery))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [entities, favoritesOnly, query, selectedTags]);

  const pushToast = (message: string, tone: ToastMessage["tone"] = "success") => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 2800);
  };

  const handleCopy = async (value: string, label: string) => {
    try {
      await platform.copyText(value);
      pushToast(`${label}已复制`);
    } catch {
      pushToast("复制失败，请检查剪贴板权限后重试", "error");
    }
  };

  const handleDownload = async (mcp: McpTool) => {
    try {
      const result = await platform.saveTextFile({
        content: serializeMcpConfig(mcp),
        defaultName: safeFilename(mcp.title, "json", "mcp-config"),
        extension: "json",
      });
      if (result === "saved") pushToast("MCP 配置已保存");
    } catch {
      pushToast("下载失败，请稍后重试", "error");
    }
  };

  useEffect(() => {
    if (!platform.hideQuickPanel) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void platform.hideQuickPanel?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [platform]);

  const handleOpenManager = async () => {
    try {
      await libraryGateway.openManager();
    } catch {
      pushToast("管理页打开失败，请重试", "error");
    }
  };

  const toggleTag = (tag: string) => {
    setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]);
  };
  const changeView = (nextView: LibraryView) => {
    setView(nextView);
    setQuery("");
    setSelectedTags([]);
  };
  const hasFilters = Boolean(query.trim() || selectedTags.length || favoritesOnly);

  return (
    <div className="side-shell">
      <header className="side-header">
        <div className="side-brand">
          <img src={brandMark} alt="" width="30" height="30" />
          <div><strong>JacobeAPI</strong><span>随手找到，立即使用</span></div>
        </div>
        <button type="button" className="side-manager-button" onClick={() => void handleOpenManager()}>
          <SquareArrowOutUpRight size={16} aria-hidden="true" />
          打开桌面
        </button>
      </header>

      <main className="side-main">
        <div className="side-toolbar">
          <div className="side-segments" role="tablist" aria-label="资料类型">
            <button type="button" role="tab" aria-selected={view === "skills"} onClick={() => changeView("skills")}>
              Skills <span>{library?.skills.length ?? 0}</span>
            </button>
            <button type="button" role="tab" aria-selected={view === "mcps"} onClick={() => changeView("mcps")}>
              MCP <span>{library?.mcps.length ?? 0}</span>
            </button>
          </div>
          <label className="side-search">
            <span className="sr-only">搜索当前资料</span>
            <Search size={17} aria-hidden="true" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索名称、内容或标签" />
          </label>
          <div className="side-filters">
            <button
              type="button"
              className={`side-filter ${favoritesOnly ? "is-active" : ""}`}
              aria-pressed={favoritesOnly}
              onClick={() => setFavoritesOnly((value) => !value)}
            >
              <Heart size={14} fill={favoritesOnly ? "currentColor" : "none"} />收藏
            </button>
            {tags.map((tag) => (
              <button
                type="button"
                className={`side-filter ${selectedTags.includes(tag) ? "is-active" : ""}`}
                aria-pressed={selectedTags.includes(tag)}
                onClick={() => toggleTag(tag)}
                key={tag}
              >{tag}</button>
            ))}
          </div>
        </div>

        {error ? (
          <div className="side-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void load()}><RefreshCw size={15} />重试</button>
          </div>
        ) : !library ? (
          <div className="side-loading" role="status"><span />正在加载资料库...</div>
        ) : visibleEntities.length ? (
          <div className="side-list" aria-label={view === "skills" ? "Skill 列表" : "MCP 列表"}>
            {visibleEntities.map((entity) => (
              <SidePanelCard entity={entity} onCopy={(value, label) => void handleCopy(value, label)} onDownload={handleDownload} key={entity.id} />
            ))}
          </div>
        ) : <EmptyState filtered={hasFilters} />}
      </main>

      <QuickAccountSummary platform={platform} />
      <ToastRegion toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
