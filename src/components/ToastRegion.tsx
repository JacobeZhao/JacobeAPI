import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { IconButton } from "./IconButton";

export interface ToastMessage {
  id: string;
  message: string;
  tone?: "success" | "error";
  actionLabel?: string;
  onAction?: () => void;
}

interface ToastRegionProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

export function ToastRegion({ toasts, onDismiss }: ToastRegionProps) {
  return (
    <div className="toast-region" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div className={`toast toast--${toast.tone ?? "success"}`} role={toast.tone === "error" ? "alert" : "status"} key={toast.id}>
          {toast.tone === "error" ? <CircleAlert size={18} /> : <CheckCircle2 size={18} />}
          <span>{toast.message}</span>
          {toast.actionLabel && toast.onAction ? (
            <button type="button" className="toast-action" onClick={toast.onAction}>{toast.actionLabel}</button>
          ) : null}
          <IconButton label="关闭通知" onClick={() => onDismiss(toast.id)}><X size={16} /></IconButton>
        </div>
      ))}
    </div>
  );
}
