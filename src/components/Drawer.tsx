import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { IconButton } from "./IconButton";

interface DrawerProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
}

export function Drawer({ open, title, description, children, onClose }: DrawerProps) {
  const panelRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    document.body.classList.add("drawer-open");
    panelRef.current?.querySelector<HTMLElement>("input, textarea, button")?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>("button, input, textarea, select, [tabindex]:not([tabindex='-1'])")]
        .filter((element) => !element.hasAttribute("disabled"));
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.classList.remove("drawer-open");
      document.removeEventListener("keydown", onKeyDown);
      previousFocus.current?.focus();
    };
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside ref={panelRef} className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" aria-describedby={description ? "drawer-description" : undefined}>
        <header className="drawer-header">
          <div>
            <h2 id="drawer-title">{title}</h2>
            {description ? <p id="drawer-description">{description}</p> : null}
          </div>
          <IconButton label="关闭编辑器" onClick={onClose}><X size={20} /></IconButton>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}
