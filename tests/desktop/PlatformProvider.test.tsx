import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { PlatformServices } from "../../src/platform/contracts";
import { PlatformProvider, usePlatform } from "../../src/platform/PlatformProvider";
import { previewPlatform } from "../../src/platform/previewPlatform";

afterEach(cleanup);

function Consumer() {
  const platform = usePlatform();
  return <span>{platform.kind}</span>;
}

describe("PlatformProvider", () => {
  it("makes the selected platform available to existing applications", () => {
    render(<PlatformProvider services={previewPlatform}><Consumer /></PlatformProvider>);
    expect(screen.getByText("preview")).toBeInTheDocument();
  });

  it("fails clearly when a consumer is not wrapped", () => {
    expect(() => render(<Consumer />)).toThrow("usePlatform must be used inside PlatformProvider");
  });

  it("preserves the exact PlatformServices object", () => {
    const services: PlatformServices = { ...previewPlatform, kind: "desktop" };
    render(<PlatformProvider services={services}><Consumer /></PlatformProvider>);
    expect(screen.getByText("desktop")).toBeInTheDocument();
  });
});
