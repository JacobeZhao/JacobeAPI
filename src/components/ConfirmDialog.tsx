import { AlertTriangle, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { IconButton } from "./IconButton";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "删除",
  onCancel,
  onConfirm,
}: ConfirmDialogProps) {
  const panelRef = useRef<HTMLElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>("button:not([disabled])")];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus.current?.focus();
    };
  }, [onCancel, open]);

  if (!open) return null;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
      <section ref={panelRef} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description">
        <div className="dialog-icon" aria-hidden="true"><AlertTriangle size={20} /></div>
        <div className="dialog-copy">
          <div className="dialog-heading">
            <h2 id="confirm-title">{title}</h2>
            <IconButton label="关闭" onClick={onCancel}><X size={18} /></IconButton>
          </div>
          <p id="confirm-description">{description}</p>
          <div className="dialog-actions">
            <button type="button" className="button button--ghost" onClick={onCancel}>取消</button>
            <button ref={confirmRef} type="button" className="button button--danger" onClick={onConfirm}>{confirmLabel}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
