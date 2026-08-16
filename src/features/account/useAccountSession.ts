import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountSessionState, AccountSessionView } from "../../domain/account";
import type { AccountGateway } from "../../platform/contracts";
import { platformErrorMessage } from "../../services/libraryAccess";

export function useAccountSession(gateway?: AccountGateway) {
  const [state, setState] = useState<AccountSessionState>(gateway ? { status: "loading" } : { status: "unavailable" });
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    if (!gateway) {
      setState({ status: "unavailable" });
      return;
    }
    const version = ++requestVersion.current;
    setState({ status: "loading" });
    try {
      const session = await gateway.getSession();
      if (requestVersion.current === version) setState({ status: "ready", session });
    } catch (error) {
      if (requestVersion.current === version) {
        setState({ status: "error", message: platformErrorMessage(error, "无法读取登录状态，请稍后重试。") });
      }
    }
  }, [gateway]);

  const acceptSession = useCallback((session: AccountSessionView) => {
    requestVersion.current += 1;
    setState({ status: "ready", session });
  }, []);

  useEffect(() => {
    if (!gateway) return;
    const version = ++requestVersion.current;
    void gateway.getSession()
      .then((session) => {
        if (requestVersion.current === version) setState({ status: "ready", session });
      })
      .catch((error: unknown) => {
        if (requestVersion.current === version) {
          setState({ status: "error", message: platformErrorMessage(error, "无法读取登录状态，请稍后重试。") });
        }
      });
    const unsubscribe = gateway.subscribeSession(acceptSession);
    return () => {
      requestVersion.current += 1;
      unsubscribe();
    };
  }, [acceptSession, gateway, load]);

  const visibleState: AccountSessionState = gateway ? state : { status: "unavailable" };
  return { state: visibleState, retry: load, acceptSession };
}
