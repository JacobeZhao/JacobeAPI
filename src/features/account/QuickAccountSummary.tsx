import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountSessionView, AccountSummarySnapshot } from "../../domain/account";
import type { PlatformServices } from "../../platform/contracts";
import { formatDecimalString } from "../../services/accountFormatting";

type SummaryState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "expired" }
  | { status: "error" }
  | { status: "ready"; summary: AccountSummarySnapshot };

function stateFromSession(session: AccountSessionView): SummaryState {
  if (session.status === "expired") return { status: "expired" };
  if (session.status === "signedOut") return { status: "signedOut" };
  return { status: "loading" };
}

function summaryStatus(summary: AccountSummarySnapshot): string {
  const labels: string[] = [];
  if (summary.source === "mock") labels.push("Mock 数据");
  if (summary.stale) labels.push("旧数据");
  return labels.join(" · ");
}

export function QuickAccountSummary({ platform }: { platform: PlatformServices }) {
  const gateway = platform.account;
  const [state, setState] = useState<SummaryState>({ status: "loading" });
  const requestVersion = useRef(0);
  const signedIn = useRef(false);

  const loadSummary = useCallback(async () => {
    if (!gateway) return;
    const version = ++requestVersion.current;
    setState((current) => current.status === "ready" ? current : { status: "loading" });
    try {
      const summary = await gateway.getSummary(false);
      if (requestVersion.current === version) setState({ status: "ready", summary });
    } catch {
      if (requestVersion.current === version) {
        setState((current) => current.status === "ready"
          ? { status: "ready", summary: { ...current.summary, stale: true } }
          : { status: "error" });
      }
    }
  }, [gateway]);

  useEffect(() => {
    if (!gateway) return;
    let active = true;

    void gateway.getSession()
      .then((session) => {
        if (!active) return;
        signedIn.current = session.status === "signedIn";
        const nextState = stateFromSession(session);
        setState(nextState);
        if (session.status === "signedIn") void loadSummary();
      })
      .catch(() => {
        if (active) setState({ status: "error" });
      });

    const stopSession = gateway.subscribeSession((session) => {
      if (!active) return;
      signedIn.current = session.status === "signedIn";
      if (session.status !== "signedIn") requestVersion.current += 1;
      setState(stateFromSession(session));
      if (session.status === "signedIn") void loadSummary();
    });
    const stopSummary = gateway.subscribeSummary((summary) => {
      if (active && signedIn.current) setState({ status: "ready", summary });
    });
    const handleFocus = () => {
      if (active && signedIn.current) void loadSummary();
    };
    window.addEventListener("focus", handleFocus);

    return () => {
      active = false;
      signedIn.current = false;
      requestVersion.current += 1;
      stopSession();
      stopSummary();
      window.removeEventListener("focus", handleFocus);
    };
  }, [gateway, loadSummary]);

  if (!gateway) return null;

  const summary = state.status === "ready" ? state.summary : null;
  const status = state.status === "loading"
    ? "读取中"
    : state.status === "signedOut"
      ? "未登录"
      : state.status === "expired"
        ? "登录已过期"
        : state.status === "error"
          ? "账户暂不可用"
          : summaryStatus(state.summary);

  return (
    <footer className="quick-account" aria-label="账户摘要" aria-live="polite">
      <span className="quick-account__metric">
        <small>今日 Token</small>
        <strong>{summary ? formatDecimalString(summary.today.total) : "--"}</strong>
      </span>
      <span className="quick-account__metric">
        <small>余额</small>
        <strong>{summary?.balance.display ?? "--"}</strong>
      </span>
      {status ? <span className="quick-account__status">{status}</span> : null}
    </footer>
  );
}
