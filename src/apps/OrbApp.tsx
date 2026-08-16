import { invoke } from "@tauri-apps/api/core";
import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import brandMark from "../desktop/assets/brand-mark.svg?url";

const DRAG_THRESHOLD = 6;

interface PointerSession {
  id: number;
  x: number;
  y: number;
  dragging: boolean;
}

export function OrbApp() {
  const session = useRef<PointerSession | null>(null);
  const [dragging, setDragging] = useState(false);
  const [failed, setFailed] = useState(false);

  const run = async (command: "begin_orb_drag" | "toggle_quick_panel" | "orb_drag_ended") => {
    try {
      await invoke<void>(command);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  };

  const handlePointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    session.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false };
  };

  const handlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const current = session.current;
    if (!current || current.id !== event.pointerId || current.dragging) return;
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < DRAG_THRESHOLD) return;
    current.dragging = true;
    setDragging(true);
    void run("begin_orb_drag");
  };

  const finishPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const current = session.current;
    if (!current || current.id !== event.pointerId) return;
    session.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (current.dragging) {
      setDragging(false);
      void run("orb_drag_ended");
    } else {
      void run("toggle_quick_panel");
    }
  };

  const cancelPointer = (event: PointerEvent<HTMLButtonElement>) => {
    const current = session.current;
    if (!current || current.id !== event.pointerId) return;
    session.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (current.dragging) {
      setDragging(false);
      void run("orb_drag_ended");
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.repeat || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    void run("toggle_quick_panel");
  };

  return (
    <main className="orb-shell">
      <button
        type="button"
        className={`orb-button ${dragging ? "orb-button--dragging" : ""} ${failed ? "orb-button--error" : ""}`}
        aria-label="打开 JacobeAPI"
        aria-describedby={failed ? "orb-status" : undefined}
        title={failed ? "暂时无法打开，请重试" : "打开 JacobeAPI"}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointer}
        onPointerCancel={cancelPointer}
        onKeyDown={handleKeyDown}
      >
        <img src={brandMark} alt="" draggable="false" />
        <span className="orb-shine" aria-hidden="true" />
      </button>
      {failed ? <span id="orb-status" className="sr-only" role="status">暂时无法打开，请重试</span> : null}
    </main>
  );
}
