import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createServer } from "./server.js";
import { MindArtStore } from "./store.js";
import { CANVAS_RESOURCE_URI } from "./tools.js";

describe("MCP server", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(
      roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
    );
  });

  it("registers tools, opens a project board, and serves the MCP App resource", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "mindart-mcp-"));
    roots.push(root);
    const htmlPath = path.join(root, "mcp-app.html");
    await writeFile(
      htmlPath,
      "<!doctype html><html><body><main>MindArt Test</main></body></html>",
      "utf8",
    );

    const server = createServer({
      store: new MindArtStore(root),
      uiHtmlPath: htmlPath,
    });
    const client = new Client({ name: "mindart-test", version: "1.0.0" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await Promise.all([
      server.connect(serverTransport),
      client.connect(clientTransport),
    ]);

    try {
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(
        expect.arrayContaining([
          "mindart_open_canvas",
          "mindart_get_board",
          "mindart_request_generation",
          "mindart_apply_result",
          "mindart_report_error",
          "mindart_update_board",
          "mindart_read_asset",
          "mindart_import_image",
        ]),
      );
      const requestTool = tools.tools.find(
        (tool) => tool.name === "mindart_request_generation",
      );
      expect(requestTool?._meta?.ui).toMatchObject({
        visibility: ["app"],
        resourceUri: CANVAS_RESOURCE_URI,
      });

      const projectRoot = path.join(root, "active-project");
      const opened = await client.callTool({
        name: "mindart_open_canvas",
        arguments: {
          board_id: "board-protocol",
          title: "Protocol",
          project_dir: projectRoot,
        },
      });
      expect(opened.isError).toBeFalsy();
      expect(opened.structuredContent).toMatchObject({
        projectRoot,
        board: { id: "board-protocol", title: "Protocol" },
      });

      const imported = await client.callTool({
        name: "mindart_import_image",
        arguments: {
          board_id: "board-protocol",
          image_data:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
          file_name: "upload.png",
          mime_type: "image/png",
        },
      });
      expect(imported.isError).toBeFalsy();
      expect(imported.structuredContent).toMatchObject({
        board: {
          id: "board-protocol",
          root: {
            children: [
              {
                title: "upload",
                status: "ready",
              },
            ],
          },
        },
      });

      const resource = await client.readResource({
        uri: CANVAS_RESOURCE_URI,
      });
      expect(resource.contents[0]?.mimeType).toBe(
        "text/html;profile=mcp-app",
      );
      expect(resource.contents[0]?.text).toContain("MindArt Test");
      expect(resource.contents[0]?._meta?.ui).toMatchObject({
        csp: { connectDomains: [], resourceDomains: [] },
      });
    } finally {
      await client.close();
      await server.close();
    }
  });
});
