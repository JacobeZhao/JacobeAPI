import { BookOpen, LogIn, RefreshCw, Server, UserRound } from "lucide-react";
import type { AccountSessionState } from "../../domain/account";
import { DESKTOP_GUEST_KIND_LIMIT } from "../../services/libraryAccess";
import "./home.css";

interface HomePageProps {
  skillCount: number;
  mcpCount: number;
  sessionState: AccountSessionState;
  onAccount(): void;
  onRetrySession(): void;
}

function SessionStatus({ state, onAccount, onRetry }: { state: AccountSessionState; onAccount(): void; onRetry(): void }) {
  if (state.status === "loading") {
    return <div className="home-account__copy" role="status"><strong>正在读取登录状态</strong><span>稍候即可查看账户状态。</span></div>;
  }
  if (state.status === "error") {
    return <><div className="home-account__copy" role="alert"><strong>登录状态暂不可用</strong><span>{state.message}</span></div><button type="button" className="button button--secondary" onClick={onRetry}><RefreshCw size={16} />重试</button></>;
  }
  if (state.status === "ready" && state.session.status === "signedIn") {
    return <div className="home-account__copy"><strong>{state.session.user.displayName}</strong><span>{state.session.source === "mock" ? "模拟账户 · 已登录" : "netapi.cc · 已登录"}</span></div>;
  }
  const expired = state.status === "ready" && state.session.status === "expired";
  return <><div className="home-account__copy"><strong>{expired ? "登录已过期" : "尚未登录"}</strong><span>{expired ? "重新登录后可继续添加内容。" : "登录后 Skill 和 MCP 数量不受访客额度限制。"}</span></div><button type="button" className="button button--primary" onClick={onAccount}><LogIn size={16} />登录或注册</button></>;
}

export function HomePage({ skillCount, mcpCount, sessionState, onAccount, onRetrySession }: HomePageProps) {
  const guest = sessionState.status !== "ready" || sessionState.session.status !== "signedIn";
  return (
    <div className="home-layout">
      <header className="home-heading">
        <span className="eyebrow">首页</span>
        <h1>你的 AI 工具资料库</h1>
        <p>查看当前收藏和账户状态，从这里继续整理常用 Skill 与 MCP 工具。</p>
      </header>

      <section className="home-stats" aria-label="资料库统计">
        <article>
          <span className="home-stat__icon home-stat__icon--skill"><BookOpen size={20} /></span>
          <div><span>Skills</span><strong aria-label={guest ? `${skillCount} / ${DESKTOP_GUEST_KIND_LIMIT}` : `${skillCount} 个 Skills`}>{skillCount}{guest ? <small> / {DESKTOP_GUEST_KIND_LIMIT}</small> : null}</strong><small>{guest ? "未登录额度" : "已保存"}</small></div>
        </article>
        <article>
          <span className="home-stat__icon home-stat__icon--mcp"><Server size={20} /></span>
          <div><span>MCP 工具</span><strong aria-label={guest ? `${mcpCount} / ${DESKTOP_GUEST_KIND_LIMIT}` : `${mcpCount} 个 MCP 工具`}>{mcpCount}{guest ? <small> / {DESKTOP_GUEST_KIND_LIMIT}</small> : null}</strong><small>{guest ? "未登录额度" : "已保存"}</small></div>
        </article>
      </section>

      <section className="home-account" aria-labelledby="home-account-title">
        <span className="home-account__icon" aria-hidden="true"><UserRound size={20} /></span>
        <div className="home-account__heading"><span className="eyebrow">账户状态</span><h2 id="home-account-title">netapi.cc</h2></div>
        <SessionStatus state={sessionState} onAccount={onAccount} onRetry={onRetrySession} />
      </section>
    </div>
  );
}
