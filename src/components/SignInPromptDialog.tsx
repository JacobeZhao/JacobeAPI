import { LogIn, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { IconButton } from "./IconButton";

interface SignInPromptDialogProps {
  open: boolean;
  title?: string;
  description: string;
  onCancel(): void;
  onContinue(): void;
}

export function SignInPromptDialog({ open, title = "登录后继续添加", description, onCancel, onContinue }: SignInPromptDialogProps) {
  const panelRef = useRef<HTMLElement>(null);
  const continueRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    continueRef.current?.focus();
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
      <section ref={panelRef} className="signin-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
        <div className="signin-dialog__icon" aria-hidden="true"><LogIn size={20} /></div>
        <div className="dialog-copy">
          <div className="dialog-heading">
            <h2 id={titleId}>{title}</h2>
            <IconButton label="关闭" onClick={onCancel}><X size={18} /></IconButton>
          </div>
          <p id={descriptionId}>{description}</p>
          <div className="dialog-actions">
            <button type="button" className="button button--ghost" onClick={onCancel}>暂不</button>
            <button ref={continueRef} type="button" className="button button--primary" onClick={onContinue}>登录或注册</button>
          </div>
        </div>
      </section>
    </div>
  );
}
