import { afterEach, describe, expect, it, vi } from "vitest";
import { starterMcps } from "../../src/domain/defaults";
import { copyText } from "../../src/services/clipboard";
import { downloadTextFile } from "../../src/services/download";
import { safeFilename } from "../../src/services/filename";
import { getMcpInstallInstructions, serializeMcpConfig } from "../../src/services/mcpConfig";

describe("side panel services", () => {
  afterEach(() => vi.restoreAllMocks());

  it("sanitizes unsafe and reserved filenames", () => {
    expect(safeFilename(' ../CON:<demo>  ', ".JSON", "mcp-config")).toBe("-CON--demo-.json");
    expect(safeFilename("CON", "json", "mcp-config")).toBe("mcp-config.json");
    expect(safeFilename("  ", "", "backup")).toBe("backup.txt");
  });

  it("serializes a standard MCP client configuration", () => {
    const mcp = { ...starterMcps[0], env: { API_TOKEN: "${API_TOKEN}" } };
    const parsed = JSON.parse(serializeMcpConfig(mcp));

    expect(parsed).toEqual({
      mcpServers: {
        filesystem: {
          command: "cmd",
          args: mcp.args,
          env: { API_TOKEN: "${API_TOKEN}" },
        },
      },
    });
    expect(getMcpInstallInstructions(mcp)).toContain("cmd /c npx -y");
    expect(getMcpInstallInstructions(mcp)).toContain(mcp.args[4]);
  });

  it("copies the requested text exactly", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });

    await copyText("line 1\nline 2");
    expect(writeText).toHaveBeenCalledWith("line 1\nline 2");
  });

  it("downloads through a short-lived object URL", () => {
    vi.useFakeTimers();
    const createObjectURL = vi.fn(() => "blob:test");
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, "createObjectURL", { value: createObjectURL, configurable: true });
    Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectURL, configurable: true });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    downloadTextFile("hello", "hello.txt");
    expect(click).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:test");
    vi.useRealTimers();
  });
});
