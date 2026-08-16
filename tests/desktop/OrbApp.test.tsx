import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(() => Promise.resolve()) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));

import { OrbApp } from "../../src/apps/OrbApp";

afterEach(cleanup);

describe("OrbApp", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens the quick panel for a click with small pointer movement", async () => {
    render(<OrbApp />);
    const orb = screen.getByRole("button", { name: "打开 JacobeAPI" });

    fireEvent.pointerDown(orb, { button: 0, pointerId: 1, clientX: 20, clientY: 20 });
    fireEvent.pointerMove(orb, { pointerId: 1, clientX: 23, clientY: 23 });
    fireEvent.pointerUp(orb, { pointerId: 1, clientX: 23, clientY: 23 });

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("toggle_quick_panel"));
    expect(mocks.invoke).not.toHaveBeenCalledWith("begin_orb_drag");
  });

  it("starts and ends a native drag after crossing the threshold", async () => {
    render(<OrbApp />);
    const orb = screen.getByRole("button", { name: "打开 JacobeAPI" });

    fireEvent.pointerDown(orb, { button: 0, pointerId: 2, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(orb, { pointerId: 2, clientX: 24, clientY: 10 });
    fireEvent.pointerUp(orb, { pointerId: 2, clientX: 24, clientY: 10 });

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith("begin_orb_drag");
      expect(mocks.invoke).toHaveBeenCalledWith("orb_drag_ended");
    });
    expect(mocks.invoke).not.toHaveBeenCalledWith("toggle_quick_panel");
  });

  it("supports Enter and Space without firing repeated key events", async () => {
    const user = userEvent.setup();
    render(<OrbApp />);
    const orb = screen.getByRole("button", { name: "打开 JacobeAPI" });

    orb.focus();
    await user.keyboard("{Enter} ");

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2));
    expect(mocks.invoke).toHaveBeenNthCalledWith(1, "toggle_quick_panel");
    expect(mocks.invoke).toHaveBeenNthCalledWith(2, "toggle_quick_panel");
  });

  it("exposes an accessible retry status when a native command fails", async () => {
    mocks.invoke.mockRejectedValueOnce(new Error("native failure"));
    const user = userEvent.setup();
    render(<OrbApp />);

    await user.click(screen.getByRole("button", { name: "打开 JacobeAPI" }));

    expect(await screen.findByRole("status")).toHaveTextContent("暂时无法打开，请重试");
  });
});
