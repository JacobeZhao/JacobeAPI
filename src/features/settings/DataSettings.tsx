import { AlertCircle, Database, Download, DownloadCloud, FileJson2, MonitorCog, RefreshCw, ShieldCheck, Upload, X } from "lucide-react";
import type { ImportStrategy } from "../../domain/types";
import { IconButton } from "../../components/IconButton";
import type { AppUpdateInfo, DesktopPreferences } from "../../platform/contracts";

export interface ImportPreviewView {
  fileName: string;
  skills: number;
  mcps: number;
  conflicts: number;
}

interface DataSettingsProps {
  skillCount: number;
  mcpCount: number;
  strategy: ImportStrategy;
  preview: ImportPreviewView | null;
  importing: boolean;
  importError?: string;
  desktopMode: boolean;
  desktopPreferences: DesktopPreferences | null;
  updateInfo: AppUpdateInfo | null;
  updateChecking: boolean;
  updateInstalling: boolean;
  updateProgress: number;
  onExport: () => void;
  onChooseFile: () => void;
  onStrategy: (strategy: ImportStrategy) => void;
  onConfirmImport: () => void;
  onCancelPreview: () => void;
  onAutostart: (enabled: boolean) => void;
  onOrbVisible: (enabled: boolean) => void;
  onAlwaysOnTop: (enabled: boolean) => void;
  onCheckUpdate: () => void;
  onInstallUpdate: () => void;
}

export function DataSettings({
  skillCount,
  mcpCount,
  strategy,
  preview,
  importing,
  importError,
  desktopMode,
  desktopPreferences,
  updateInfo,
  updateChecking,
  updateInstalling,
  updateProgress,
  onExport,
  onChooseFile,
  onStrategy,
  onConfirmImport,
  onCancelPreview,
  onAutostart,
  onOrbVisible,
  onAlwaysOnTop,
  onCheckUpdate,
  onInstallUpdate,
}: DataSettingsProps) {
  return (
    <div className="settings-layout">
      <header className="section-heading">
        <div>
          <span className="eyebrow">数据与备份</span>
          <h1>把自己的收藏握在手里</h1>
          <p>所有内容保存在{desktopMode ? "这台电脑" : "当前浏览器"}。定期导出一份 JSON 备份，可以避免卸载或清理数据后丢失。</p>
        </div>
        <div className="library-stat" aria-label={`当前有 ${skillCount} 个 Skills 和 ${mcpCount} 个 MCP 工具`}>
          <Database size={20} />
          <strong>{skillCount + mcpCount}</strong>
          <span>条内容</span>
        </div>
      </header>

      <section className="settings-section" aria-labelledby="export-heading">
        <div className="settings-section__icon settings-section__icon--green"><Download size={21} /></div>
        <div className="settings-section__content">
          <h2 id="export-heading">导出备份</h2>
          <p>下载一个可以再次导入 JacobeAPI 的 JSON 文件。备份中会包含 Skill、MCP 配置和标签。</p>
          <div className="notice notice--warning"><AlertCircle size={17} /><span>MCP 环境变量可能含有密钥。分享备份前，请先检查文件内容。</span></div>
        </div>
        <button type="button" className="button button--secondary" onClick={onExport}><Download size={17} />导出 JSON</button>
      </section>

      <section className="settings-section settings-section--import" aria-labelledby="import-heading">
        <div className="settings-section__icon settings-section__icon--violet"><Upload size={21} /></div>
        <div className="settings-section__content">
          <h2 id="import-heading">导入备份</h2>
          <p>选择 JacobeAPI 导出的 JSON 文件。写入前会先检查内容并显示预览，不会静默覆盖。</p>
          <button type="button" className="file-picker" onClick={onChooseFile}>
            <FileJson2 size={20} />
            <span><strong>选择 JSON 文件</strong><small>最大 4 MB</small></span>
          </button>
          {importError ? <div className="notice notice--error" role="alert"><AlertCircle size={17} /><span>{importError}</span></div> : null}

          {preview ? (
            <div className="import-preview" aria-live="polite">
              <div className="import-preview__header">
                <div><span>已检查文件</span><strong>{preview.fileName}</strong></div>
                <IconButton label="取消导入" onClick={onCancelPreview}><X size={17} /></IconButton>
              </div>
              <dl>
                <div><dt>Skills</dt><dd>{preview.skills}</dd></div>
                <div><dt>MCP 工具</dt><dd>{preview.mcps}</dd></div>
                <div><dt>发现重复</dt><dd>{preview.conflicts}</dd></div>
              </dl>
              <fieldset className="strategy-fieldset">
                <legend>遇到重复内容时</legend>
                <label><input type="radio" name="strategy" value="skip" checked={strategy === "skip"} onChange={() => onStrategy("skip")} /><span><strong>跳过重复</strong><small>保留当前内容，适合大多数情况</small></span></label>
                <label><input type="radio" name="strategy" value="overwrite" checked={strategy === "overwrite"} onChange={() => onStrategy("overwrite")} /><span><strong>使用备份版本</strong><small>只覆盖 ID 相同的内容</small></span></label>
                <label><input type="radio" name="strategy" value="replace" checked={strategy === "replace"} onChange={() => onStrategy("replace")} /><span><strong>完全替换</strong><small>删除当前内容，仅保留备份</small></span></label>
              </fieldset>
              {strategy === "replace" ? <div className="notice notice--error"><AlertCircle size={17} /><span>完全替换会移除当前库中未包含在备份里的内容。</span></div> : null}
              <button type="button" className="button button--primary" disabled={importing} onClick={onConfirmImport}>
                {importing ? "正在导入…" : "确认导入"}
              </button>
            </div>
          ) : null}
        </div>
      </section>

      {desktopMode ? (
        <>
        <section className="settings-section" aria-labelledby="update-heading">
          <div className="settings-section__icon settings-section__icon--violet"><DownloadCloud size={21} /></div>
          <div className="settings-section__content">
            <h2 id="update-heading">应用更新</h2>
            <p>{updateInfo ? `发现 JacobeAPI ${updateInfo.version}，安装后会自动重启。` : "启动时会自动检查，也可以在这里手动检查新版本。"}</p>
            {updateInfo?.notes ? <div className="notice"><span>{updateInfo.notes}</span></div> : null}
            {updateInstalling ? <progress value={updateProgress} max="100" aria-label="更新下载进度">{updateProgress}%</progress> : null}
          </div>
          {updateInfo ? (
            <button type="button" className="button button--primary" disabled={updateInstalling} onClick={onInstallUpdate}>
              <Download size={17} />{updateInstalling ? `正在更新 ${updateProgress}%` : "下载并安装"}
            </button>
          ) : (
            <button type="button" className="button button--secondary" disabled={updateChecking} onClick={onCheckUpdate}>
              <RefreshCw size={17} />{updateChecking ? "正在检查" : "检查更新"}
            </button>
          )}
        </section>
        <section className="settings-section settings-section--desktop" aria-labelledby="desktop-heading">
          <div className="settings-section__icon settings-section__icon--green"><MonitorCog size={21} /></div>
          <div className="settings-section__content">
            <h2 id="desktop-heading">桌面体验</h2>
            <p>悬浮球和开机启动只影响当前 Windows 用户，可以随时在这里更改。</p>
            <div className="desktop-toggles" aria-busy={!desktopPreferences}>
              <label>
                <span><strong>显示悬浮球</strong><small>从桌面快速打开 Skills</small></span>
                <input type="checkbox" checked={desktopPreferences?.orbVisible ?? false} disabled={!desktopPreferences} onChange={(event) => onOrbVisible(event.target.checked)} />
              </label>
              <label>
                <span><strong>始终置顶</strong><small>让悬浮球保持在其他窗口上方</small></span>
                <input type="checkbox" checked={desktopPreferences?.alwaysOnTop ?? false} disabled={!desktopPreferences} onChange={(event) => onAlwaysOnTop(event.target.checked)} />
              </label>
              <label>
                <span><strong>开机自动启动</strong><small>启动后只显示悬浮球，不打断当前工作</small></span>
                <input type="checkbox" checked={desktopPreferences?.autostartEnabled ?? false} disabled={!desktopPreferences} onChange={(event) => onAutostart(event.target.checked)} />
              </label>
            </div>
          </div>
        </section>
        </>
      ) : null}

      <div className="privacy-note"><ShieldCheck size={20} /><div><strong>仅保存在本机</strong><span>JacobeAPI 不会上传这些内容，也不连接远程市场。</span></div></div>
    </div>
  );
}
