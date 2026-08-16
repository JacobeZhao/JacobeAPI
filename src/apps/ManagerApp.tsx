import {
  ArrowDownUp,
  BookOpen,
  ChevronDown,
  Database,
  Menu,
  Plus,
  Search,
  Server,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import brandMark from "../desktop/assets/brand-mark.svg?url";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { Drawer } from "../components/Drawer";
import { IconButton } from "../components/IconButton";
import { ToastRegion, type ToastMessage } from "../components/ToastRegion";
import { LIBRARY_LIMITS } from "../domain/limits";
import type { CardEntity, ImportStrategy, LibraryMutation, LibraryState, LibraryView, Skill, SortMode } from "../domain/types";
import { CardGrid } from "../features/library/CardGrid";
import { EntityEditor } from "../features/library/EntityEditor";
import { AccountPage } from "../features/account/AccountPage";
import { DataSettings, type ImportPreviewView } from "../features/settings/DataSettings";
import type { AppUpdateInfo, DesktopPreferences } from "../platform/contracts";
import { usePlatform } from "../platform/PlatformProvider";
import { serializeSkillMarkdown } from "../services/download";
import { safeFilename } from "../services/filename";
import { prepareLibraryImport, parseLibraryImport, serializeLibraryExport } from "../services/importExport";
import { buildMcpConfig } from "../services/mcpConfig";
import { filterCards, getAllTags } from "../services/search";

type ManagerPage = LibraryView | "account" | "settings";

interface PendingImport {
  raw: string;
  incoming: LibraryState;
  preview: ImportPreviewView;
}

function messageFromError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function cardMutation(card: CardEntity): LibraryMutation {
  return card.kind === "skill" ? { type: "upsert-skill", skill: card } : { type: "upsert-mcp", mcp: card };
}

function NavButton({ active, icon, label, count, onClick }: { active: boolean; icon: React.ReactNode; label: string; count?: number; onClick: () => void }) {
  return (
    <button type="button" className={`nav-button ${active ? "nav-button--active" : ""}`} aria-current={active ? "page" : undefined} onClick={onClick}>
      {icon}<span>{label}</span>{typeof count === "number" ? <b>{count}</b> : null}
    </button>
  );
}

export function ManagerApp() {
  const platform = usePlatform();
  const libraryGateway = platform.library;
  const [library, setLibrary] = useState<LibraryState | null>(null);
  const [page, setPage] = useState<ManagerPage>("skills");
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [drawer, setDrawer] = useState<{ kind: CardEntity["kind"]; entity?: CardEntity } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CardEntity | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [loadingError, setLoadingError] = useState("");
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [strategy, setStrategy] = useState<ImportStrategy>("skip");
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [confirmReplaceImport, setConfirmReplaceImport] = useState(false);
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  const [desktopPreferences, setDesktopPreferences] = useState<DesktopPreferences | null>(null);
  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | null>(null);
  const [updateChecking, setUpdateChecking] = useState(false);
  const [updateInstalling, setUpdateInstalling] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const libraryRef = useRef<LibraryState | null>(null);

  const syncLibrary = useCallback((state: LibraryState) => {
    libraryRef.current = state;
    setLibrary(state);
  }, []);

  const pushToast = useCallback((toast: Omit<ToastMessage, "id">) => {
    const id = crypto.randomUUID();
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), toast.actionLabel ? 8000 : 4000);
  }, []);

  const load = useCallback(async () => {
    setLoadingError("");
    try {
      const state = await libraryGateway.getLibrary();
      syncLibrary(state);
      setPage(state.preferences.managerView);
    } catch (error) {
      setLoadingError(messageFromError(error, "资料库暂时无法打开，请重试。"));
    }
  }, [libraryGateway, syncLibrary]);

  useEffect(() => {
    let active = true;
    void libraryGateway.getLibrary()
      .then((state) => {
        if (!active) return;
        syncLibrary(state);
        setPage(state.preferences.managerView);
      })
      .catch((error: unknown) => {
        if (active) setLoadingError(messageFromError(error, "资料库暂时无法打开，请重试。"));
      });
    const unsubscribe = libraryGateway.subscribeLibrary((state) => {
      if (active) syncLibrary(state);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [libraryGateway, syncLibrary]);

  useEffect(() => {
    if (!platform.getDesktopPreferences) return;
    void platform.getDesktopPreferences()
      .then(setDesktopPreferences)
      .catch(() => pushToast({ tone: "error", message: "桌面设置加载失败，请稍后重试。" }));
  }, [platform, pushToast]);

  useEffect(() => {
    if (!platform.appUpdate) return;
    void platform.appUpdate.check().then((update) => {
      setAppUpdate(update);
      if (update) pushToast({
        message: `发现 JacobeAPI ${update.version}`,
        actionLabel: "查看更新",
        onAction: () => setPage("settings"),
      });
    }).catch(() => undefined);
  }, [platform.appUpdate, pushToast]);

  useEffect(() => {
    if (!platform.subscribeManagerDestination) return;
    return platform.subscribeManagerDestination((destination) => {
      if (destination === "account") setPage("account");
      else setPage(libraryRef.current?.preferences.managerView ?? "skills");
      setMobileNavOpen(false);
    });
  }, [platform]);

  const commit = useCallback(async (mutation: LibraryMutation) => {
    const current = libraryRef.current;
    if (!current) throw new Error("资料库尚未加载完成");
    try {
      const next = await libraryGateway.mutateLibrary(mutation, current.revision);
      syncLibrary(next);
      return next;
    } catch (error) {
      pushToast({ tone: "error", message: messageFromError(error, "保存失败，请重试。") });
      throw error;
    }
  }, [libraryGateway, pushToast, syncLibrary]);

  const cards = useMemo<CardEntity[]>(
    () => page === "mcps" ? library?.mcps ?? [] : library?.skills ?? [],
    [library, page],
  );
  const tags = useMemo(() => getAllTags(cards), [cards]);
  const visibleCards = useMemo(() => {
    if (!library || page === "settings") return [];
    const filtered = filterCards(cards, { query, tags: selectedTags });
    return [...filtered].sort((left, right) => {
      if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
      return library.preferences.sort === "title-asc"
        ? left.title.localeCompare(right.title, "zh-CN")
        : new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });
  }, [cards, library, page, query, selectedTags]);

  const switchPage = (next: ManagerPage) => {
    setPage(next);
    setMobileNavOpen(false);
    setQuery("");
    setSelectedTags([]);
    if ((next === "skills" || next === "mcps") && library?.preferences.managerView !== next) {
      void commit({ type: "set-preferences", preferences: { managerView: next } }).catch(() => undefined);
    }
  };

  const changeSort = (sort: SortMode) => {
    if (!library || library.preferences.sort === sort) return;
    void commit({ type: "set-preferences", preferences: { sort } }).catch(() => undefined);
  };

  const saveEntity = async (entity: CardEntity) => {
    await commit(cardMutation(entity));
    setDrawer(null);
    pushToast({ message: entity.kind === "skill" ? "Skill 已保存" : "MCP 工具已保存" });
  };

  const toggleFavorite = (card: CardEntity) => {
    void commit({ type: "toggle-favorite", kind: card.kind, id: card.id }).catch(() => undefined);
  };

  const confirmDelete = async () => {
    const card = pendingDelete;
    if (!card) return;
    try {
      await commit({ type: "delete-card", kind: card.kind, id: card.id });
      setPendingDelete(null);
      pushToast({
        message: `已删除“${card.title}”`,
        actionLabel: "撤销",
        onAction: () => void commit(cardMutation(card)).then(() => pushToast({ message: "已恢复" })).catch(() => undefined),
      });
    } catch {
      // The shared error toast explains the failure and keeps the confirmation open.
    }
  };

  const copyCard = async (card: CardEntity) => {
    try {
      await platform.copyText(card.kind === "skill" ? card.prompt : buildMcpConfig(card));
      pushToast({ message: card.kind === "skill" ? "提示词已复制" : "MCP 配置已复制" });
    } catch (error) {
      pushToast({ tone: "error", message: messageFromError(error, "复制失败，请再试一次。") });
    }
  };

  const copyInstallNotes = async (skill: Skill) => {
    try {
      await platform.copyText(skill.installNotes);
      pushToast({ message: "使用说明已复制" });
    } catch (error) {
      pushToast({ tone: "error", message: messageFromError(error, "复制失败，请再试一次。") });
    }
  };

  const downloadSkill = async (skill: Skill) => {
    try {
      const result = await platform.saveTextFile({
        content: serializeSkillMarkdown(skill),
        defaultName: safeFilename(skill.title, "md", "skill"),
        extension: "md",
      });
      if (result === "saved") pushToast({ message: "Skill 文件已保存" });
    } catch (error) {
      pushToast({ tone: "error", message: messageFromError(error, "Skill 文件保存失败，请重试。") });
    }
  };

  const exportLibrary = async () => {
    if (!library) return;
    try {
      const result = await platform.saveTextFile({
        content: serializeLibraryExport(library, "0.1.0"),
        defaultName: `jacobeapi-${new Date().toISOString().slice(0, 10)}.json`,
        extension: "json",
      });
      if (result === "saved") pushToast({ message: "备份已导出" });
    } catch (error) {
      pushToast({ tone: "error", message: messageFromError(error, "备份导出失败，请重试。") });
    }
  };

  const inspectImport = async () => {
    setImportError("");
    setPendingImport(null);
    try {
      const file = await platform.pickJsonFile();
      if (!file) return;
      if (new TextEncoder().encode(file.text).byteLength > LIBRARY_LIMITS.maxImportBytes) {
        throw new Error("文件超过 4 MB，请选择较小的 JacobeAPI 备份。");
      }
      const raw = file.text;
      const incoming = parseLibraryImport(raw);
      const currentIds = new Set([...(library?.skills ?? []), ...(library?.mcps ?? [])].map(({ id }) => id));
      const conflicts = [...incoming.skills, ...incoming.mcps].filter(({ id }) => currentIds.has(id)).length;
      setPendingImport({
        raw,
        incoming,
        preview: { fileName: file.name, skills: incoming.skills.length, mcps: incoming.mcps.length, conflicts },
      });
    } catch (error) {
      setImportError(messageFromError(error, "无法读取这个备份文件，请确认它来自 JacobeAPI。"));
    }
  };

  const updateDesktopPreference = async (
    operation: ((enabled: boolean) => Promise<DesktopPreferences>) | undefined,
    enabled: boolean,
    failureMessage: string,
  ) => {
    if (!operation) return;
    try {
      setDesktopPreferences(await operation(enabled));
    } catch (error) {
      pushToast({ tone: "error", message: messageFromError(error, failureMessage) });
    }
  };

  const checkForUpdate = async () => {
    if (!platform.appUpdate) return;
    setUpdateChecking(true);
    try {
      const update = await platform.appUpdate.check();
      setAppUpdate(update);
      pushToast({ message: update ? `发现 JacobeAPI ${update.version}` : "当前已是最新版本" });
    } catch (error) {
      pushToast({ tone: "error", message: messageFromError(error, "检查更新失败，请稍后重试。") });
    } finally {
      setUpdateChecking(false);
    }
  };

  const installUpdate = async () => {
    if (!platform.appUpdate || !appUpdate) return;
    setUpdateInstalling(true);
    setUpdateProgress(0);
    try {
      await platform.appUpdate.install(setUpdateProgress);
    } catch (error) {
      setUpdateInstalling(false);
      pushToast({ tone: "error", message: messageFromError(error, "更新安装失败，请稍后重试。") });
    }
  };

  const confirmImport = async () => {
    if (!pendingImport || !library) return;
    setImporting(true);
    try {
      const preview = prepareLibraryImport(pendingImport.raw, library, strategy);
      await commit({ type: "import-state", state: preview.candidate });
      setPendingImport(null);
      setConfirmReplaceImport(false);
      setImportError("");
      pushToast({ message: "备份已导入" });
    } catch (error) {
      setImportError(messageFromError(error, "导入失败，当前资料没有改变。"));
    } finally {
      setImporting(false);
    }
  };

  const requestImport = () => {
    if (strategy === "replace") setConfirmReplaceImport(true);
    else void confirmImport();
  };

  if (!library && loadingError) {
    return (
      <main className="fatal-state">
        <div className="fatal-state__mark"><Sparkles size={24} /></div>
        <h1>资料库没有打开</h1><p>{loadingError}</p>
        <button type="button" className="button button--primary" onClick={() => void load()}>重新加载</button>
      </main>
    );
  }

  return (
    <div className="manager-shell">
      <aside className={`sidebar ${mobileNavOpen ? "sidebar--open" : ""}`} aria-label="主导航">
        <div className="brand"><img src={brandMark} alt="" /><div><strong>JacobeAPI</strong><span>AI Skills &amp; MCP</span></div></div>
        <nav>
          <span className="nav-label">资料库</span>
          <NavButton active={page === "skills"} icon={<BookOpen size={19} />} label="Skills" count={library?.skills.length} onClick={() => switchPage("skills")} />
          <NavButton active={page === "mcps"} icon={<Server size={19} />} label="MCP 工具" count={library?.mcps.length} onClick={() => switchPage("mcps")} />
          <span className="nav-label nav-label--spaced">管理</span>
          {platform.account ? <NavButton active={page === "account"} icon={<UserRound size={19} />} label="账户与用量" onClick={() => switchPage("account")} /> : null}
          <NavButton active={page === "settings"} icon={<Database size={19} />} label="数据与备份" onClick={() => switchPage("settings")} />
        </nav>
        <div className="sidebar-note"><span className="status-dot" />本地资料库<span>Skill 与 MCP 不上传</span></div>
      </aside>

      {mobileNavOpen ? <button type="button" className="sidebar-scrim" aria-label="关闭导航" onClick={() => setMobileNavOpen(false)} /> : null}

      <main className="manager-main">
        <div className="mobile-bar">
          <IconButton label="打开导航" onClick={() => setMobileNavOpen(true)}><Menu size={20} /></IconButton>
          <span>JacobeAPI</span>
        </div>

        {page === "account" ? (
          <AccountPage platform={platform} onNotify={(message, tone) => pushToast({ message, tone })} />
        ) : page === "settings" && library ? (
          <DataSettings
            skillCount={library.skills.length}
            mcpCount={library.mcps.length}
            strategy={strategy}
            preview={pendingImport?.preview ?? null}
            importing={importing}
            importError={importError}
            desktopMode={platform.kind === "desktop"}
            desktopPreferences={desktopPreferences}
            updateInfo={appUpdate}
            updateChecking={updateChecking}
            updateInstalling={updateInstalling}
            updateProgress={updateProgress}
            onExport={() => void exportLibrary()}
            onChooseFile={() => void inspectImport()}
            onStrategy={setStrategy}
            onConfirmImport={requestImport}
            onCancelPreview={() => { setPendingImport(null); setImportError(""); }}
            onAutostart={(enabled) => void updateDesktopPreference(platform.setAutostart, enabled, "开机启动设置失败。")}
            onOrbVisible={(enabled) => void updateDesktopPreference(platform.setOrbVisible, enabled, "悬浮球设置失败。")}
            onAlwaysOnTop={(enabled) => void updateDesktopPreference(platform.setAlwaysOnTop, enabled, "置顶设置失败。")}
            onCheckUpdate={() => void checkForUpdate()}
            onInstallUpdate={() => void installUpdate()}
          />
        ) : (
          <div className="library-layout">
            <header className="page-header">
              <div><span className="eyebrow">个人资料库</span><h1>{page === "skills" ? "我的 Skills" : "MCP 工具"}</h1><p>{page === "skills" ? "随手整理好提示词，需要时一键取用。" : "集中保存 MCP 启动参数，复制配置更省心。"}</p></div>
              <button type="button" className="button button--primary button--create" onClick={() => setDrawer({ kind: page === "mcps" ? "mcp" : "skill" })}><Plus size={18} />新建{page === "mcps" ? " MCP" : " Skill"}</button>
            </header>

            <section className="library-toolbar" aria-label="搜索和筛选">
              <label className="search-field"><Search size={18} aria-hidden="true" /><span className="sr-only">搜索</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={page === "skills" ? "搜索名称、提示词或标签" : "搜索工具、命令或标签"} />{query ? <IconButton label="清空搜索" onClick={() => setQuery("")}><X size={16} /></IconButton> : null}</label>
              <details className="filter-menu">
                <summary><SlidersHorizontal size={17} />标签{selectedTags.length ? <b>{selectedTags.length}</b> : null}<ChevronDown size={15} /></summary>
                <fieldset><legend>满足任一标签</legend>{tags.length ? tags.map((tag) => <label key={tag}><input type="checkbox" checked={selectedTags.includes(tag)} onChange={() => setSelectedTags((current) => current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag])} /><span>{tag}</span></label>) : <p>还没有标签</p>}{selectedTags.length ? <button type="button" onClick={() => setSelectedTags([])}>清除筛选</button> : null}</fieldset>
              </details>
              <label className="sort-select"><ArrowDownUp size={17} /><span className="sr-only">排序方式</span><select value={library?.preferences.sort ?? "updated-desc"} onChange={(event) => changeSort(event.target.value as SortMode)}><option value="updated-desc">最近更新</option><option value="title-asc">名称排序</option></select></label>
              <span className="result-count">{library ? `${visibleCards.length} / ${cards.length}` : "正在加载"}</span>
            </section>

            {!library ? (
              <div className="card-grid" aria-label="正在加载"><div className="skeleton-card" /><div className="skeleton-card" /><div className="skeleton-card" /></div>
            ) : visibleCards.length ? (
              <CardGrid cards={visibleCards} onCopy={(card) => void copyCard(card)} onCopyInstall={(skill) => void copyInstallNotes(skill)} onDownload={downloadSkill} onEdit={(entity) => setDrawer({ kind: entity.kind, entity })} onDelete={setPendingDelete} onToggleFavorite={toggleFavorite} />
            ) : (
              <section className="empty-state">
                <div>{query || selectedTags.length ? <Search size={25} /> : <Sparkles size={25} />}</div>
                <h2>{query || selectedTags.length ? "没有找到匹配内容" : `还没有 ${page === "skills" ? "Skill" : "MCP 工具"}`}</h2>
                <p>{query || selectedTags.length ? "换个关键词，或者清除标签筛选后再试。" : page === "skills" ? "把第一条常用提示词收进来，下次就不用到处翻找。" : "保存常用服务器配置，需要时直接复制。"}</p>
                {query || selectedTags.length ? <button type="button" className="button button--secondary" onClick={() => { setQuery(""); setSelectedTags([]); }}>清除筛选</button> : <button type="button" className="button button--primary" onClick={() => setDrawer({ kind: page === "mcps" ? "mcp" : "skill" })}><Plus size={17} />立即新建</button>}
              </section>
            )}
          </div>
        )}
      </main>

      <Drawer open={Boolean(drawer)} title={`${drawer?.entity ? "编辑" : "新建"}${drawer?.kind === "mcp" ? " MCP 工具" : " Skill"}`} description={drawer?.kind === "mcp" ? "参数和环境变量将生成标准 MCP 配置。" : "提示词会完整保存，卡片中只显示预览。"} onClose={() => setDrawer(null)}>
        {drawer ? <EntityEditor kind={drawer.kind} entity={drawer.entity} onCancel={() => setDrawer(null)} onSave={saveEntity} /> : null}
      </Drawer>
      <ConfirmDialog open={Boolean(pendingDelete)} title={`删除“${pendingDelete?.title ?? ""}”？`} description="删除后可在通知消失前撤销。" onCancel={() => setPendingDelete(null)} onConfirm={() => void confirmDelete()} />
      <ConfirmDialog open={confirmReplaceImport} title="替换整个资料库？" description="当前所有 Skill 和 MCP 工具都会被备份中的内容替换。请确认已经导出当前资料。" confirmLabel="确认替换" onCancel={() => setConfirmReplaceImport(false)} onConfirm={() => void confirmImport()} />
      <ToastRegion toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
    </div>
  );
}
