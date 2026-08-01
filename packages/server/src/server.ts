import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MindArtStore } from "./store.js";
import { registerMindArtTools } from "./tools.js";
import { registerCanvasResource } from "./ui-resource.js";

export interface CreateServerOptions {
  store?: MindArtStore;
  uiHtmlPath?: string;
}

export function createServer(options: CreateServerOptions = {}): McpServer {
  const store = options.store ?? new MindArtStore();
  const server = new McpServer({
    name: "MindArt",
    version: "0.1.0",
  });

  registerMindArtTools(server, store);
  registerCanvasResource(server, options.uiHtmlPath);
  return server;
}
