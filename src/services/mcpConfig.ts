import type { McpTool } from "../domain/types";

interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

function quoteArgument(value: string): string {
  if (!value || /\s|["']/u.test(value)) return JSON.stringify(value);
  return value;
}

export function getMcpInstallInstructions(mcp: McpTool): string {
  return [mcp.command, ...mcp.args].map(quoteArgument).join(" ");
}

export function serializeMcpConfig(mcp: McpTool): string {
  const server: McpServerConfig = { command: mcp.command };
  if (mcp.args.length) server.args = [...mcp.args];
  if (Object.keys(mcp.env).length) server.env = { ...mcp.env };

  return `${JSON.stringify({ mcpServers: { [mcp.serverName]: server } }, null, 2)}\n`;
}

export const buildMcpConfig = serializeMcpConfig;
