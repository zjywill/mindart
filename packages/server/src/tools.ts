import { registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import path from "node:path";
import { z } from "zod";
import {
  BoardIdSchema,
  BoardPatchSchema,
  BoardSchema,
  GenerationRequestInputSchema,
} from "./model.js";
import {
  MAX_IMPORT_IMAGE_BASE64_LENGTH,
  MindArtStore,
} from "./store.js";

export const CANVAS_RESOURCE_URI = "ui://mindart/canvas.html";

const appOnlyMeta = {
  ui: {
    resourceUri: CANVAS_RESOURCE_URI,
    visibility: ["app"] as const,
  },
};

function success<T extends object>(
  message: string,
  structuredContent: T,
): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: structuredContent as Record<string, unknown>,
  };
}

export function registerMindArtTools(
  server: McpServer,
  initialStore: MindArtStore,
): void {
  let store = initialStore;
  registerAppTool(
    server,
    "mindart_open_canvas",
    {
      title: "Open MindArt Canvas",
      description:
        "Open or create the MindArt image genealogy canvas for the active project. This is the single user-facing entry point for MindArt.",
      inputSchema: z.object({
        board_id: BoardIdSchema.optional(),
        title: z.string().trim().min(1).max(200).optional(),
        project_dir: z.string().trim().min(1).optional(),
      }),
      outputSchema: z.object({
        board: BoardSchema,
        projectRoot: z.string(),
      }),
      _meta: { ui: { resourceUri: CANVAS_RESOURCE_URI } },
    },
    async ({ board_id, title, project_dir }) => {
      if (
        project_dir &&
        path.resolve(project_dir) !== path.resolve(store.projectRoot)
      ) {
        store = new MindArtStore(project_dir);
        await store.initialize();
      }
      // Naming a board that is not here means we are looking in the wrong
      // project, not that one should be conjured under that id. Creating it
      // would drop an empty board where the real one was expected and hide the
      // misrouting behind a canvas that merely looks new.
      if (board_id && !(await store.hasBoard(board_id))) {
        throw new Error(
          `MindArt board ${board_id} does not exist under ${store.projectRoot}. ` +
            "Pass project_dir for the project that owns it, or omit board_id to open the most recent board.",
        );
      }
      const board = await store.openBoard(board_id, title);
      return success(`Opened MindArt board "${board.title}" (${board.id}).`, {
        board,
        projectRoot: store.projectRoot,
      });
    },
  );

  registerAppTool(
    server,
    "mindart_get_board",
    {
      title: "Get MindArt Board",
      description:
        "Read a MindArt board, including its image-card tree, references, and generation history.",
      inputSchema: z.object({
        board_id: BoardIdSchema,
      }),
      outputSchema: z.object({ board: BoardSchema }),
      _meta: { ui: { resourceUri: CANVAS_RESOURCE_URI } },
    },
    async ({ board_id }) => {
      const board = await store.getBoard(board_id);
      return success(`Loaded MindArt board "${board.title}".`, { board });
    },
  );

  registerAppTool(
    server,
    "mindart_request_generation",
    {
      title: "Queue MindArt Generation",
      description:
        "Queue an image generation request compiled from a target card, its parent image, and up to four cross-branch references. This tool is called only by the MindArt canvas.",
      inputSchema: z.object({
        board_id: BoardIdSchema,
        node_id: z.string().trim().min(1),
        request: GenerationRequestInputSchema,
      }),
      outputSchema: z.object({
        board: BoardSchema,
        requestId: z.string(),
        compiledPrompt: z.string(),
        refs: z.array(
          z.object({
            node: z.string(),
            usage: z.string(),
            asset: z.string(),
          }),
        ),
      }),
      _meta: appOnlyMeta,
    },
    async ({ board_id, node_id, request }) => {
      const result = await store.requestGeneration(board_id, node_id, request);
      return success(`Queued generation request ${result.requestId}.`, result);
    },
  );

  registerAppTool(
    server,
    "mindart_apply_result",
    {
      title: "Apply MindArt Image Result",
      description:
        "After generating the requested image, call this tool with the exact request id and local image path. MindArt copies the image into the board assets and replaces the queued card in place.",
      inputSchema: z.object({
        request_id: z.string().trim().min(1),
        image_path: z.string().trim().min(1),
      }),
      outputSchema: z.object({ board: BoardSchema }),
      _meta: { ui: { visibility: ["model"] } },
    },
    async ({ request_id, image_path }) => {
      const board = await store.applyResult(request_id, image_path);
      return success(
        `Applied image result for ${request_id} to board "${board.title}".`,
        { board },
      );
    },
  );

  registerAppTool(
    server,
    "mindart_report_error",
    {
      title: "Report MindArt Generation Error",
      description:
        "Call this when an image generation request cannot be completed so the card becomes retryable and records the error.",
      inputSchema: z.object({
        request_id: z.string().trim().min(1),
        message: z.string().trim().min(1).max(10_000),
      }),
      outputSchema: z.object({ board: BoardSchema }),
      _meta: { ui: { visibility: ["model"] } },
    },
    async ({ request_id, message }) => {
      const board = await store.reportError(request_id, message);
      return success(`Recorded generation error for ${request_id}.`, { board });
    },
  );

  registerAppTool(
    server,
    "mindart_update_board",
    {
      title: "Update MindArt Board",
      description:
        "Persist board title, style, tree, references, and history changes made in the MindArt canvas. This tool is called only by the canvas.",
      inputSchema: z.object({
        board_id: BoardIdSchema,
        patch: BoardPatchSchema,
      }),
      outputSchema: z.object({ board: BoardSchema }),
      _meta: appOnlyMeta,
    },
    async ({ board_id, patch }) => {
      const board = await store.updateBoard(board_id, patch);
      return success(`Saved MindArt board "${board.title}".`, { board });
    },
  );

  registerAppTool(
    server,
    "mindart_read_asset",
    {
      title: "Read MindArt Asset",
      description:
        "Read a project-local MindArt image as base64 for lazy rendering in the canvas. This tool is called only by the canvas.",
      inputSchema: z.object({
        board_id: BoardIdSchema,
        path: z.string().trim().min(1),
      }),
      outputSchema: z.object({
        path: z.string(),
        mimeType: z.string(),
        data: z.string(),
      }),
      _meta: appOnlyMeta,
    },
    async ({ board_id, path }) => {
      const asset = await store.readAsset(board_id, path);
      return success(`Read asset ${asset.path}.`, asset);
    },
  );

  registerAppTool(
    server,
    "mindart_import_image",
    {
      title: "Import Image Into MindArt",
      description:
        "Import an uploaded image or local project image into a MindArt board as a ready image card. Provide image_data with file_name, or provide source_path.",
      inputSchema: z.object({
        board_id: BoardIdSchema.optional(),
        source_path: z.string().trim().min(1).optional(),
        image_data: z
          .string()
          .trim()
          .min(1)
          .max(MAX_IMPORT_IMAGE_BASE64_LENGTH)
          .optional(),
        file_name: z.string().trim().min(1).max(255).optional(),
        mime_type: z.string().trim().min(1).max(100).optional(),
        parent_node_id: z.string().trim().min(1).optional(),
        title: z.string().trim().min(1).max(200).optional(),
      }),
      outputSchema: z.object({
        board: BoardSchema,
        nodeId: z.string(),
      }),
      _meta: { ui: { resourceUri: CANVAS_RESOURCE_URI } },
    },
    async ({
      board_id,
      source_path,
      image_data,
      file_name,
      mime_type,
      parent_node_id,
      title,
    }) => {
      if (Boolean(source_path) === Boolean(image_data)) {
        throw new Error("Provide either image_data or source_path");
      }
      if (image_data && !file_name) {
        throw new Error("file_name is required with image_data");
      }
      const result = await store.importImage({
        ...(board_id === undefined ? {} : { boardId: board_id }),
        ...(source_path === undefined ? {} : { sourcePath: source_path }),
        ...(image_data === undefined ? {} : { imageData: image_data }),
        ...(file_name === undefined ? {} : { fileName: file_name }),
        ...(mime_type === undefined ? {} : { mimeType: mime_type }),
        ...(parent_node_id === undefined
          ? {}
          : { parentNodeId: parent_node_id }),
        ...(title === undefined ? {} : { title }),
      });
      return success(`Imported image as node ${result.nodeId}.`, result);
    },
  );
}
