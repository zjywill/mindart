import {
  registerAppResource,
  RESOURCE_MIME_TYPE,
  type McpUiReadResourceResult,
} from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CANVAS_RESOURCE_URI } from "./tools.js";

export function defaultUiHtmlPath(): string {
  return path.join(import.meta.dirname, "ui", "mcp-app.html");
}

export function registerCanvasResource(
  server: McpServer,
  htmlPath = defaultUiHtmlPath(),
): void {
  registerAppResource(
    server,
    CANVAS_RESOURCE_URI,
    CANVAS_RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      description: "MindArt interactive image genealogy canvas",
    },
    async (): Promise<McpUiReadResourceResult> => {
      const html = await readFile(htmlPath, "utf8");
      return {
        contents: [
          {
            uri: CANVAS_RESOURCE_URI,
            mimeType: RESOURCE_MIME_TYPE,
            text: html,
            _meta: {
              ui: {
                csp: {
                  connectDomains: [],
                  resourceDomains: [],
                },
              },
            },
          },
        ],
      };
    },
  );
}
