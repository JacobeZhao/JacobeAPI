import {
  AlertTriangle,
  Check,
  ChevronRight,
  KeyRound,
  LogOut,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  TerminalSquare,
  Trophy,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import "./account.css";
import type {
  AccountSessionView,
  AccountSummarySnapshot,
  LeaderboardSnapshot,
  LoginRequest,
} from "../../domain/account";
import type {
  CliConfigApplyResult,
  CliConfigBackupView,
  CliConfigPreview,
  CliConfigStatus,
  CliTarget,
} from "../../domain/cliConfig";
import type { PlatformServices } from "../../platform/contracts";

interface AccountPageProps {
  platform: PlatformServices;
  onNotify(message: string, tone?: "success" | "error"): void;
}

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

function targetName(target: CliTarget) {
  return target === "codex" ? "Codex" : "Claude Code";
}

function formatTime(value?: string) {
  if (!value) return "--";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "--" : date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
}

function formatDecimalInteger(value: string) {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return value;
  return normalized.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function LoginPanel({ onLogin, onRegister, busy, error }: { onLogin(request: LoginRequest): Promise<void>; onRegister(event: React.MouseEvent<HTMLAnchorElement>): void; busy: boolean; error: string }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    await onLogin({ identifier: identifier.trim(), password });
    setPassword("");
  };
  return (
    <section className="account-login" aria-labelledby="account-login-title">
      <div className="account-login__copy">
        <span className="eyebrow">netapi.cc</span>
        <h1 id="account-login-title">连接你的中转站账户</h1>
        <p>登录后可查看今日 Token、余额和用量排行，并为本机 AI 工具生成安全的配置预览。</p>
        <a href="https://netapi.cc/" target="_blank" rel="noreferrer" onClick={onRegister}>还没有账户？前往注册 <ChevronRight size={15} /></a>
      </div>
      <form onSubmit={(event) => void submit(event)}>
        <label><span>账号</span><input autoComplete="username" value={identifier} onChange={(event) => setIdentifier(event.target.value)} placeholder="邮箱或用户名" required /></label>
        <label><span>密码</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="输入登录密码" required /></label>
        {error ? <p className="account-inline-error" role="alert">{error}</p> : null}
        <button className="button button--primary" type="submit" disabled={busy || !identifier.trim() || !password}>
          <KeyRound size={17} />{busy ? "正在连接..." : "登录 netapi.cc"}
        </button>
        <small>演示账户：<code>demo@netapi.cc</code> / <code>jacobe-demo</code>。该账户只读取本机 mock 数据。</small>
      </form>
    </section>
  );
}

function ConfigPanel({ platform, onNotify }: AccountPageProps) {
  const gateway = platform.cliConfig;
  const [statuses, setStatuses] = useState<CliConfigStatus[]>([]);
  const [preview, setPreview] = useState<CliConfigPreview | null>(null);
  const [backups, setBackups] = useState<CliConfigBackupView[]>([]);
  const [busy, setBusy] = useState<string>("");
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    if (!gateway) return;
    try {
      setStatuses(await gateway.scan());
      const groups = await Promise.all((["codex", "claude"] as CliTarget[]).map((target) => gateway.listBackups(target)));
      setBackups(groups.flat());
    } catch (reason) {
      setError(errorMessage(reason, "无法检测本机配置。"));
    }
  }, [gateway]);

  useEffect(() => {
    if (!gateway) return;
    let active = true;
    void Promise.all([
      gateway.scan(),
      ...(["codex", "claude"] as CliTarget[]).map((target) => gateway.listBackups(target)),
    ]).then(([nextStatuses, ...groups]) => {
      if (!active) return;
      setStatuses(nextStatuses);
      setBackups(groups.flat());
    }).catch((reason: unknown) => {
      if (active) setError(errorMessage(reason, "无法检测本机配置。"));
    });
    return () => { active = false; };
  }, [gateway]);

  const createPreview = async (target: CliTarget) => {
    if (!gateway) return;
    setBusy(target); setError("");
    try { setPreview(await gateway.preview(target)); }
    catch (reason) { setError(errorMessage(reason, "无法生成配置预览。")); }
    finally { setBusy(""); }
  };

  const apply = async () => {
    if (!gateway || !preview) return;
    setBusy("apply"); setError("");
    try {
      const result: CliConfigApplyResult = await gateway.apply(preview.planId);
      onNotify(`${targetName(result.target)} 配置已应用`);
      setPreview(null);
      await refresh();
    } catch (reason) { setError(errorMessage(reason, "配置未应用，原文件保持不变。")); }
    finally { setBusy(""); }
  };

  const restore = async (backup: CliConfigBackupView) => {
    if (!gateway) return;
    setBusy(backup.id); setError("");
    try {
      await gateway.restore(backup.id);
      onNotify(`${targetName(backup.target)} 已恢复上一份配置`);
      await refresh();
    } catch (reason) { setError(errorMessage(reason, "恢复失败，备份仍然保留。")); }
    finally { setBusy(""); }
  };

  if (!gateway) return null;
  return (
    <section className="account-section" aria-labelledby="cli-config-title">
      <div className="account-section__heading"><div><span className="eyebrow">本机模型</span><h2 id="cli-config-title">一键配置 AI 工具</h2><p>先预览，再备份并写入。不会覆盖 MCP、插件或其他未知设置。</p></div><ShieldCheck size={22} /></div>
      {error ? <p className="account-inline-error" role="alert"><AlertTriangle size={15} />{error}</p> : null}
      <div className="config-targets">
        {(["codex", "claude"] as CliTarget[]).map((target) => {
          const status = statuses.find((item) => item.target === target);
          return <article className="config-target" key={target}>
            <div className="config-target__icon"><TerminalSquare size={20} /></div>
            <div><h3>{targetName(target)}</h3><p>{status?.path ?? "正在检测配置路径..."}</p><span className={`config-health config-health--${status?.health ?? "missing"}`}>{status?.configuredForNetapi ? "已连接 netapi" : status?.health === "invalid" ? "配置需要修复" : "尚未连接"}</span></div>
            <button className="button button--secondary" type="button" disabled={Boolean(busy)} onClick={() => void createPreview(target)}>{busy === target ? "生成中..." : "配置"}</button>
          </article>;
        })}
      </div>
      {preview ? <div className="config-preview" role="dialog" aria-label={`${targetName(preview.target)} 配置预览`}>
        <div className="config-preview__heading"><div><strong>{targetName(preview.target)} 配置预览</strong><span>{preview.path}</span></div><button type="button" onClick={() => setPreview(null)}>关闭</button></div>
        <ul>{preview.changes.map((change) => <li key={change.field}><span>{change.action === "add" ? "新增" : change.action === "update" ? "更新" : "保留"}</span><code>{change.field}</code><b>{change.after}</b></li>)}</ul>
        {preview.warnings.map((warning) => <p className="config-warning" key={warning}><AlertTriangle size={14} />{warning}</p>)}
        <div className="config-preview__actions"><span>{preview.backupWillBeCreated ? "应用前会自动创建备份" : "此配置没有可备份的原文件"}</span><button className="button button--primary" type="button" disabled={busy === "apply"} onClick={() => void apply()}><Check size={17} />{busy === "apply" ? "正在校验..." : "确认应用"}</button></div>
      </div> : null}
      <div className="config-backups"><div><strong>最近备份</strong><span>{backups.length ? `${backups.length} 份可恢复配置` : "应用配置后会在这里保留恢复点"}</span></div>{backups.slice(0, 4).map((backup) => <button type="button" disabled={Boolean(busy)} onClick={() => void restore(backup)} key={backup.id}><RotateCcw size={15} /><span>{targetName(backup.target)}<small>{new Date(backup.createdAt).toLocaleString("zh-CN")}</small></span></button>)}</div>
    </section>
  );
}

export function AccountPage({ platform, onNotify }: AccountPageProps) {
  const gateway = platform.account;
  const [session, setSession] = useState<AccountSessionView | null>(null);
  const [summary, setSummary] = useState<AccountSummarySnapshot | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [leaderboardError, setLeaderboardError] = useState("");

  const openRegistration = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!platform.openExternalUrl) return;
    event.preventDefault();
    void platform.openExternalUrl("https://netapi.cc/")
      .catch(() => onNotify("注册页面打开失败，请稍后重试。", "error"));
  };

  const loadSummary = useCallback(async (forceRefresh = false) => {
    if (!gateway) return;
    setSummaryError("");
    try { setSummary(await gateway.getSummary(forceRefresh)); }
    catch (reason) { setSummaryError(errorMessage(reason, "账户摘要暂时不可用，请稍后重试。")); }
  }, [gateway]);

  const loadLeaderboard = useCallback(async (forceRefresh = false) => {
    if (!gateway) return;
    setLeaderboardError("");
    try { setLeaderboard(await gateway.getLeaderboard({ forceRefresh, limit: 50 })); }
    catch (reason) { setLeaderboardError(errorMessage(reason, "排行榜暂时不可用，请稍后重试。")); }
  }, [gateway]);

  useEffect(() => {
    if (!gateway) return;
    let active = true;
    void gateway.getSession().then((value) => {
      if (!active) return;
      setSession(value);
      if (value.status === "signedIn") {
        void gateway.getSummary(false).then((snapshot) => { if (active) setSummary(snapshot); }).catch((reason: unknown) => { if (active) setSummaryError(errorMessage(reason, "账户摘要暂时不可用，请稍后重试。")); });
        void gateway.getLeaderboard({ limit: 50 }).then((snapshot) => { if (active) setLeaderboard(snapshot); }).catch((reason: unknown) => { if (active) setLeaderboardError(errorMessage(reason, "排行榜暂时不可用，请稍后重试。")); });
      }
    }).catch((reason) => { if (active) setError(errorMessage(reason, "无法读取登录状态。")); });
    const stopSession = gateway.subscribeSession((value) => {
      if (!active) return;
      setSession(value);
      if (value.status === "signedIn") {
        void gateway.getSummary(false).then((snapshot) => { if (active) setSummary(snapshot); }).catch(() => undefined);
        void gateway.getLeaderboard({ limit: 50 }).then((snapshot) => { if (active) setLeaderboard(snapshot); }).catch(() => undefined);
      } else {
        setSummary(null);
        setLeaderboard(null);
      }
    });
    const stopSummary = gateway.subscribeSummary((value) => { if (active) setSummary(value); });
    const stopLeaderboard = gateway.subscribeLeaderboard((value) => { if (active) setLeaderboard(value); });
    return () => { active = false; stopSession(); stopSummary(); stopLeaderboard(); };
  }, [gateway]);

  const login = async (request: LoginRequest) => {
    if (!gateway) return;
    setBusy(true); setError("");
    try {
      setSession(await gateway.login(request));
      await Promise.all([loadSummary(false), loadLeaderboard(false)]);
    }
    catch (reason) { setError(errorMessage(reason, "登录失败，请检查账号或网络。")); }
    finally { setBusy(false); }
  };

  const logout = async () => {
    if (!gateway) return;
    setBusy(true);
    try { await gateway.logout(); setSummary(null); setLeaderboard(null); setSession({ status: "signedOut", source: session?.source ?? "mock" }); }
    catch (reason) { setError(errorMessage(reason, "退出登录失败。")); }
    finally { setBusy(false); }
  };

  if (!gateway) return <section className="account-unavailable"><h1>账户功能仅在桌面版提供</h1><p>Chrome 扩展继续保持完全本地运行。</p></section>;
  if (!session || session.status !== "signedIn") return <div className="account-layout"><LoginPanel onLogin={login} onRegister={openRegistration} busy={busy} error={error} /></div>;

  return <div className="account-layout">
    <header className="account-header"><div><span className="eyebrow">账户与用量</span><h1>你好，{session.user?.displayName ?? "netapi 用户"}</h1><p>数据更新时间 {formatTime(summary?.generatedAt)}</p></div><div className="account-header__actions">{summary?.source === "mock" || session.source === "mock" ? <span className="source-badge">模拟数据</span> : null}<button className="button button--secondary" type="button" disabled={busy} onClick={() => void logout()}><LogOut size={16} />退出</button></div></header>
    {error || summaryError ? <div className="account-banner" role="alert"><AlertTriangle size={17} /><span>{error || summaryError}</span><button type="button" onClick={() => void loadSummary(true)}><RefreshCw size={15} />重试</button></div> : null}
    <section className="usage-grid" aria-label="账户摘要">
      <article><div className="usage-icon usage-icon--tokens"><Trophy size={20} /></div><span>今日 Token</span><strong>{summary ? formatDecimalInteger(summary.today.total) : "--"}</strong><small>{summary ? `输入 ${formatDecimalInteger(summary.today.input)} · 输出 ${formatDecimalInteger(summary.today.output)}` : "正在读取"}</small></article>
      <article><div className="usage-icon usage-icon--balance"><WalletCards size={20} /></div><span>账户余额</span><strong>{summary?.balance.display ?? "--"}</strong><small>{summary?.balance.unit ?? (summary ? "暂不可用" : "正在读取")}</small></article>
      <article><div className="usage-icon"><Trophy size={20} /></div><span>我的排名</span><strong>{leaderboard?.currentUserRank ? `#${leaderboard.currentUserRank}` : "--"}</strong><small>按今日 Token 用量</small></article>
      <button className="usage-refresh" type="button" disabled={busy} onClick={() => { void loadSummary(true); void loadLeaderboard(true); }} aria-label="刷新账户数据"><RefreshCw size={17} /></button>
    </section>
    <section className="account-section" aria-labelledby="leaderboard-title"><div className="account-section__heading"><div><span className="eyebrow">今日排行</span><h2 id="leaderboard-title">Token 使用榜</h2><p>显示由服务端提供的脱敏名称，不上传本机资料。</p></div><Trophy size={22} /></div>
      {leaderboardError ? <div className="account-banner" role="alert"><AlertTriangle size={17} /><span>{leaderboardError}</span><button type="button" onClick={() => void loadLeaderboard(true)}><RefreshCw size={15} />重试</button></div> : null}
      <div className="leaderboard"><div className="leaderboard__header"><span>排名</span><span>用户</span><span>Token</span></div>{leaderboard?.rows.length ? leaderboard.rows.map((row) => <div className={row.isCurrentUser ? "is-current" : ""} key={`${row.rank}-${row.userId}`}><b>#{row.rank}</b><span>{row.displayName}{row.isCurrentUser ? <small>你</small> : null}</span><strong>{formatDecimalInteger(row.tokens)}</strong></div>) : <p>{leaderboard ? "今天还没有排行数据" : leaderboardError ? "排行榜加载失败" : "正在加载排行榜..."}</p>}</div>
    </section>
    <ConfigPanel platform={platform} onNotify={onNotify} />
  </div>;
}
