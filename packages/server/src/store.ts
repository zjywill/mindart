import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  BoardPatchSchema,
  BoardIdSchema,
  GenerationRequestInputSchema,
  cardsById,
  createEmptyBoard,
  parseStoredBoard,
  placeCard,
  validateBoard,
  type Board,
  type BoardCard,
  type BoardPatch,
  type GenerationRequestInput,
  type GenerationRecord,
  type NodeReference,
} from "./model.js";
import { compileGenerationRequest } from "./compile.js";
import { resolveInside, resolveProjectRoot } from "./paths.js";

const IMAGE_EXTENSIONS = new Set([
  ".apng",
  ".avif",
  ".gif",
  ".jpg",
  ".jpeg",
  ".png",
  ".svg",
  ".webp",
]);

const MIME_TYPES: Record<string, string> = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  "image/apng": ".apng",
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/svg+xml": ".svg",
  "image/webp": ".webp",
};

export const MAX_IMPORT_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMPORT_IMAGE_BASE64_LENGTH =
  Math.ceil(MAX_IMPORT_IMAGE_BYTES / 3) * 4;

/**
 * Older skills pass the v1 board root as "no source here". The root card is
 * gone, but the meaning survives.
 */
const DETACHED_SENTINEL = "root";

interface GenerationResult {
  board: Board;
  requestId: string;
  compiledPrompt: string;
  refs: GenerationRecord["refs"];
}

export interface AssetResult {
  path: string;
  mimeType: string;
  data: string;
}

function safeFileStem(value: string): string {
  const stem = value
    .normalize("NFKD")
    .replace(/[^\w.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return stem || "image";
}

function resolveImageExtension(fileName: string, mimeType?: string): string {
  const fileExtension = path.extname(fileName).toLowerCase();
  if (IMAGE_EXTENSIONS.has(fileExtension)) return fileExtension;
  const mimeExtension = mimeType
    ? EXTENSION_BY_MIME_TYPE[mimeType.toLowerCase()]
    : undefined;
  if (mimeExtension) return mimeExtension;
  throw new Error(`Unsupported image type: ${fileExtension || mimeType || "(none)"}`);
}

function decodeImageData(data: string): Buffer {
  const normalized = data.replace(/\s+/gu, "");
  if (
    !normalized ||
    normalized.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/u.test(normalized)
  ) {
    throw new Error("Image data must be valid base64");
  }
  const contents = Buffer.from(normalized, "base64");
  if (!contents.length) throw new Error("Image file is empty");
  if (contents.length > MAX_IMPORT_IMAGE_BYTES) {
    throw new Error("Image file must be 20 MB or smaller");
  }
  return contents;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

/**
 * The canvas owns titles, prompts, notes, references, and positions; the
 * server owns generation state and assets. A save from the canvas therefore
 * keeps the server-owned fields of every card it already knows, and anything
 * the canvas invented arrives as a plain draft.
 */
function mergeEditableCards(
  currentNodes: readonly BoardCard[],
  incomingNodes: readonly BoardCard[],
): BoardCard[] {
  const current = new Map(currentNodes.map((card) => [card.id, card]));
  return incomingNodes.map((incoming) => {
    const existing = current.get(incoming.id);
    const next = clone(incoming);
    if (existing) {
      for (const field of ["status", "requestId", "asset", "error"] as const) {
        if (existing[field] === undefined) {
          delete next[field];
        } else {
          next[field] = existing[field] as never;
        }
      }
    } else {
      delete next.requestId;
      delete next.asset;
      delete next.error;
      next.status = "draft";
    }
    return next;
  });
}

export interface SourceInput {
  nodeId: string;
  usage: string;
}

/**
 * Turn a list of source cards into the references a derived card carries.
 *
 * Unknown or image-less sources throw rather than being skipped. A silently
 * dropped source is how a board ends up as a scatter of unrelated cards,
 * which is exactly the failure this helper exists to prevent.
 */
function buildSourceReferences(
  cards: Map<string, BoardCard>,
  nodeId: string,
  sources: readonly SourceInput[],
): NodeReference[] {
  const refs: NodeReference[] = [];
  const seen = new Set<string>();

  for (const source of sources) {
    if (seen.has(source.nodeId)) continue;
    if (source.nodeId === nodeId) {
      throw new Error("A card cannot be its own source");
    }
    const sourceCard = cards.get(source.nodeId);
    if (!sourceCard) throw new Error(`Source node not found: ${source.nodeId}`);
    if (!sourceCard.asset) {
      throw new Error(
        `Source node ${source.nodeId} has no image to reference yet`,
      );
    }
    if (refs.length >= 5) {
      throw new Error("A card can carry at most 5 reference images");
    }
    refs.push({
      order: refs.length + 1,
      source: sourceCard.id,
      usage: source.usage,
    });
    seen.add(sourceCard.id);
  }

  return refs;
}

/**
 * Put the primary source first without losing anyone's usage note. The
 * detached sentinel — the v1 board root — means "no primary source".
 */
function orderSources(
  sources: readonly SourceInput[],
  primaryNodeId: string | undefined,
): SourceInput[] {
  if (!primaryNodeId || primaryNodeId === DETACHED_SENTINEL) {
    return [...sources];
  }
  const primary = sources.find((source) => source.nodeId === primaryNodeId) ?? {
    nodeId: primaryNodeId,
    usage: "",
  };
  return [
    primary,
    ...sources.filter((source) => source.nodeId !== primaryNodeId),
  ];
}

export class MindArtStore {
  readonly projectRoot: string;
  readonly mindartRoot: string;
  readonly #writeQueues = new Map<string, Promise<void>>();

  constructor(projectRoot = resolveProjectRoot()) {
    this.projectRoot = path.resolve(projectRoot);
    this.mindartRoot = path.join(this.projectRoot, "mindart");
  }

  async initialize(): Promise<void> {
    await mkdir(this.mindartRoot, { recursive: true });
  }

  boardDirectory(boardId: string): string {
    return path.join(this.mindartRoot, BoardIdSchema.parse(boardId));
  }

  boardFile(boardId: string): string {
    return path.join(this.boardDirectory(boardId), "board.json");
  }

  async listBoards(): Promise<Array<{ id: string; title: string; updatedAt: string }>> {
    await this.initialize();
    const entries = await readdir(this.mindartRoot, { withFileTypes: true });
    const boards = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const board = await this.getBoard(entry.name);
        boards.push({
          id: board.id,
          title: board.title,
          updatedAt: board.updatedAt,
        });
      } catch {
        // Invalid directories are ignored so one damaged board does not hide others.
      }
    }
    return boards.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async openBoard(boardId?: string, title?: string): Promise<Board> {
    await this.initialize();
    if (boardId) {
      try {
        return await this.getBoard(boardId);
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
    }

    if (!boardId && title === undefined) {
      const [latest] = await this.listBoards();
      if (latest) return this.getBoard(latest.id);
    }

    const id = boardId ?? `board-${randomUUID().slice(0, 8)}`;
    const board = createEmptyBoard(
      id,
      title?.trim() || "未命名画板",
    );
    await this.writeBoard(board);
    return board;
  }

  async getBoard(boardId: string): Promise<Board> {
    const raw = await readFile(this.boardFile(boardId), "utf8");
    return parseStoredBoard(JSON.parse(raw));
  }

  async hasBoard(boardId: string): Promise<boolean> {
    try {
      await readFile(this.boardFile(boardId), "utf8");
      return true;
    } catch (error) {
      if (isMissingFile(error)) return false;
      throw error;
    }
  }

  async updateBoard(boardId: string, patch: BoardPatch): Promise<Board> {
    const parsedPatch = BoardPatchSchema.parse(patch);
    return this.mutateBoard(boardId, (board) => {
      if (parsedPatch.title !== undefined) board.title = parsedPatch.title;
      if (parsedPatch.styleNote !== undefined) {
        board.styleNote = parsedPatch.styleNote;
      }
      if (parsedPatch.nodes !== undefined) {
        board.nodes = mergeEditableCards(board.nodes, parsedPatch.nodes);
      }
      return board;
    });
  }

  async requestGeneration(
    boardId: string,
    nodeId: string,
    input: GenerationRequestInput,
  ): Promise<GenerationResult> {
    const request = GenerationRequestInputSchema.parse(input);
    let result: GenerationResult | undefined;

    const board = await this.mutateBoard(boardId, (draft) => {
      const cards = cardsById(draft);
      const card = cards.get(nodeId);
      if (!card) throw new Error(`Node not found: ${nodeId}`);

      const refs: NodeReference[] = [];
      const seen = new Set<string>();
      for (const reference of request.refs) {
        if (seen.has(reference.sourceNodeId)) continue;
        const source = cards.get(reference.sourceNodeId);
        if (!source?.asset) {
          throw new Error(
            `Reference node ${reference.sourceNodeId} has no image asset`,
          );
        }
        if (source.id === nodeId) {
          throw new Error("A node cannot reference itself");
        }
        if (refs.length >= 5) {
          throw new Error("A generation can use at most 5 reference images");
        }
        refs.push({
          order: refs.length + 1,
          source: source.id,
          usage: reference.usage,
        });
        seen.add(source.id);
      }

      card.prompt = request.prompt;
      if (request.note !== undefined) card.note = request.note;
      if (refs.length) card.refs = refs;
      else delete card.refs;
      card.status = "queued";
      delete card.error;

      const requestId = `req-${randomUUID().slice(0, 12)}`;
      card.requestId = requestId;

      const compiled = compileGenerationRequest(
        draft,
        nodeId,
        this.boardDirectory(boardId),
        requestId,
      );
      draft.requests[requestId] = {
        nodeId,
        compiledPrompt: compiled.compiledPrompt,
        refs: compiled.refs,
        status: "queued",
        createdAt: new Date().toISOString(),
      };
      result = {
        board: draft,
        requestId,
        compiledPrompt: compiled.compiledPrompt,
        refs: compiled.refs,
      };
      return draft;
    });

    if (!result) throw new Error("Generation request was not created");
    return { ...result, board };
  }

  async applyResult(requestId: string, imagePath: string): Promise<Board> {
    const located = await this.findRequest(requestId);
    const sourcePath = await this.resolveInputImage(imagePath);
    const extension = path.extname(sourcePath).toLowerCase();
    const assetName = `${safeFileStem(requestId)}${extension}`;
    const relativeAsset = path.posix.join("assets", assetName);
    const destination = path.join(
      this.boardDirectory(located.boardId),
      relativeAsset,
    );

    await mkdir(path.dirname(destination), { recursive: true });
    if (path.resolve(sourcePath) !== path.resolve(destination)) {
      await copyFile(sourcePath, destination);
    }

    return this.mutateBoard(located.boardId, (board) => {
      const request = board.requests[requestId];
      if (!request) throw new Error(`Request not found: ${requestId}`);
      const card = board.nodes.find((node) => node.id === request.nodeId);
      if (!card) throw new Error(`Request node not found: ${request.nodeId}`);

      const now = new Date().toISOString();
      request.status = "ready";
      request.asset = relativeAsset;
      request.resolvedAt = now;
      delete request.error;
      card.status = "ready";
      card.asset = relativeAsset;
      card.requestId = requestId;
      delete card.error;
      return board;
    });
  }

  async reportError(requestId: string, message: string): Promise<Board> {
    const located = await this.findRequest(requestId);
    return this.mutateBoard(located.boardId, (board) => {
      const request = board.requests[requestId];
      if (!request) throw new Error(`Request not found: ${requestId}`);
      const card = board.nodes.find((node) => node.id === request.nodeId);
      if (!card) throw new Error(`Request node not found: ${request.nodeId}`);

      const now = new Date().toISOString();
      request.status = "error";
      request.error = message;
      request.resolvedAt = now;
      card.status = "error";
      card.error = message;
      return board;
    });
  }

  async importImage(options: {
    boardId?: string;
    sourcePath?: string;
    imageData?: string;
    fileName?: string;
    mimeType?: string;
    parentNodeId?: string;
    sources?: readonly SourceInput[];
    prompt?: string;
    title?: string;
    x?: number;
    y?: number;
  }): Promise<{ board: Board; nodeId: string; refs: NodeReference[] }> {
    const hasSourcePath = Boolean(options.sourcePath?.trim());
    const hasImageData = Boolean(options.imageData?.trim());
    if (hasSourcePath === hasImageData) {
      throw new Error("Provide either an image file or a source path");
    }

    let sourcePath: string | undefined;
    let imageData: Buffer | undefined;
    let sourceName: string;
    let extension: string;

    if (hasSourcePath) {
      sourcePath = await this.resolveInputImage(options.sourcePath!);
      sourceName = path.basename(sourcePath);
      extension = path.extname(sourcePath).toLowerCase();
    } else {
      sourceName = options.fileName?.trim() ?? "";
      if (!sourceName) throw new Error("Image file name is required");
      extension = resolveImageExtension(sourceName, options.mimeType);
      imageData = decodeImageData(options.imageData!);
    }

    const board = await this.openBoard(options.boardId);
    const nodeId = `node-${randomUUID().slice(0, 10)}`;
    const defaultTitle = path.basename(sourceName, path.extname(sourceName));
    const assetName = `${safeFileStem(options.title ?? defaultTitle)}-${randomUUID().slice(0, 6)}${extension}`;
    const relativeAsset = path.posix.join("assets", assetName);
    const destination = path.join(
      this.boardDirectory(board.id),
      relativeAsset,
    );
    await mkdir(path.dirname(destination), { recursive: true });
    if (sourcePath) {
      await copyFile(sourcePath, destination);
    } else {
      await writeFile(destination, imageData!);
    }

    const updated = await this.mutateBoard(board.id, (draft) => {
      const cards = cardsById(draft);
      const sources = orderSources(
        options.sources ?? [],
        options.parentNodeId,
      );
      const primary = sources[0] ? cards.get(sources[0].nodeId) : undefined;
      if (
        options.parentNodeId &&
        options.parentNodeId !== DETACHED_SENTINEL &&
        !cards.has(options.parentNodeId)
      ) {
        throw new Error(`Parent node not found: ${options.parentNodeId}`);
      }
      const refs = buildSourceReferences(cards, nodeId, sources);
      const prompt = options.prompt?.trim();
      const position =
        options.x !== undefined && options.y !== undefined
          ? { x: options.x, y: options.y }
          : placeCard(draft.nodes, primary);
      draft.nodes.push({
        id: nodeId,
        title: options.title?.trim() || defaultTitle || "素材图",
        status: "ready",
        // The instruction that produced the image belongs on the card, so the
        // lineage reads as a record of how the image was made and the card can
        // be regenerated from the canvas without retyping it.
        ...(prompt ? { prompt } : {}),
        asset: relativeAsset,
        ...(refs.length ? { refs } : {}),
        ...position,
      });
      return draft;
    });

    // normalizeBoard runs inside the write, so report the references that
    // actually survived rather than the ones we hoped to write.
    const stored = updated.nodes.find((card) => card.id === nodeId);
    return { board: updated, nodeId, refs: stored?.refs ?? [] };
  }

  /**
   * Record where an existing card's image came from.
   *
   * The first reference is the primary source, so setting parentNodeId moves
   * that card to the front of the list. This is the repair path for a board
   * whose cards were dropped in flat before anyone said how they relate.
   */
  async linkSources(
    boardId: string,
    nodeId: string,
    options: {
      parentNodeId?: string;
      sources?: readonly SourceInput[];
    },
  ): Promise<{ board: Board; nodeId: string; refs: NodeReference[] }> {
    const board = await this.mutateBoard(boardId, (draft) => {
      const cards = cardsById(draft);
      const card = cards.get(nodeId);
      if (!card) throw new Error(`Node not found: ${nodeId}`);
      if (
        options.parentNodeId &&
        options.parentNodeId !== DETACHED_SENTINEL &&
        !cards.has(options.parentNodeId)
      ) {
        throw new Error(`Parent node not found: ${options.parentNodeId}`);
      }

      const sources =
        options.sources ??
        (card.refs ?? []).map((reference) => ({
          nodeId: reference.source,
          usage: reference.usage,
        }));
      const ordered = orderSources(sources, options.parentNodeId);
      const refs = buildSourceReferences(cards, nodeId, ordered);
      if (refs.length) card.refs = refs;
      else delete card.refs;
      return draft;
    });

    const stored = board.nodes.find((card) => card.id === nodeId);
    return { board, nodeId, refs: stored?.refs ?? [] };
  }

  /**
   * Resolve a board-relative asset to an absolute path, refusing anything that
   * is not an image under this board's assets directory. Every caller that
   * hands a path to the filesystem — or to the OS — goes through here.
   */
  assetFilePath(boardId: string, assetPath: string): string {
    const normalized = assetPath.replaceAll("\\", "/");
    if (!normalized.startsWith("assets/")) {
      throw new Error("Only board assets can be read");
    }
    const filePath = resolveInside(this.boardDirectory(boardId), normalized);
    const extension = path.extname(filePath).toLowerCase();
    if (!MIME_TYPES[extension]) {
      throw new Error(`Unsupported image type: ${extension}`);
    }
    return filePath;
  }

  async readAsset(boardId: string, assetPath: string): Promise<AssetResult> {
    const boardDir = this.boardDirectory(boardId);
    const normalized = assetPath.replaceAll("\\", "/");
    if (!normalized.startsWith("assets/")) {
      throw new Error("Only board assets can be read");
    }
    const filePath = resolveInside(boardDir, normalized);
    const extension = path.extname(filePath).toLowerCase();
    const mimeType = MIME_TYPES[extension];
    if (!mimeType) throw new Error(`Unsupported image type: ${extension}`);
    let data: Buffer;
    try {
      data = await readFile(filePath);
    } catch (error) {
      // The raw ENOENT message carries an absolute path and looks transient.
      // The canvas needs a stable marker to tell "the file is gone" apart
      // from failures worth retrying.
      if (isMissingFile(error)) {
        throw new Error(`Asset missing: ${normalized}`);
      }
      throw error;
    }
    return {
      path: normalized,
      mimeType,
      data: data.toString("base64"),
    };
  }

  async findRequest(
    requestId: string,
  ): Promise<{ boardId: string; request: GenerationRecord }> {
    for (const board of await this.listBoards()) {
      const full = await this.getBoard(board.id);
      const request = full.requests[requestId];
      if (request) return { boardId: board.id, request };
    }
    throw new Error(`Request not found: ${requestId}`);
  }

  private async resolveInputImage(inputPath: string): Promise<string> {
    const candidate = path.isAbsolute(inputPath)
      ? path.resolve(inputPath)
      : path.resolve(this.projectRoot, inputPath);
    const extension = path.extname(candidate).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) {
      throw new Error(`Unsupported image type: ${extension || "(none)"}`);
    }
    const info = await stat(candidate);
    if (!info.isFile()) throw new Error("Image path is not a file");
    return candidate;
  }

  private async mutateBoard(
    boardId: string,
    mutate: (board: Board) => Board,
  ): Promise<Board> {
    let output: Board | undefined;
    await this.enqueue(boardId, async () => {
      const board = await this.getBoard(boardId);
      const next = mutate(clone(board));
      next.updatedAt = new Date().toISOString();
      output = validateBoard(next);
      await this.writeBoardUnlocked(output);
    });
    if (!output) throw new Error("Board update did not complete");
    return output;
  }

  private async writeBoard(board: Board): Promise<void> {
    await this.enqueue(board.id, () => this.writeBoardUnlocked(board));
  }

  private async writeBoardUnlocked(board: Board): Promise<void> {
    const parsed = validateBoard(board);
    const directory = this.boardDirectory(parsed.id);
    const assetsDirectory = path.join(directory, "assets");
    await mkdir(assetsDirectory, { recursive: true });
    const file = this.boardFile(parsed.id);
    const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    await rename(temporary, file);
  }

  private async enqueue(boardId: string, work: () => Promise<void>): Promise<void> {
    const previous = this.#writeQueues.get(boardId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(work);
    this.#writeQueues.set(boardId, current);
    try {
      await current;
    } finally {
      if (this.#writeQueues.get(boardId) === current) {
        this.#writeQueues.delete(boardId);
      }
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
