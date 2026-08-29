import path from "node:path";
import { z } from "zod";

export const NODE_STATUSES = [
  "draft",
  "queued",
  "generating",
  "ready",
  "error",
] as const;

export type NodeStatus = (typeof NODE_STATUSES)[number];

export interface NodeReference {
  order: number;
  source: string;
  usage: string;
}

export interface BoardCard {
  id: string;
  title: string;
  status?: NodeStatus | undefined;
  prompt?: string | undefined;
  note?: string | undefined;
  refs?: NodeReference[] | undefined;
  requestId?: string | undefined;
  asset?: string | undefined;
  error?: string | undefined;
  x: number;
  y: number;
}

export interface GenerationReference {
  node: string;
  usage: string;
  asset: string;
}

export interface GenerationRecord {
  nodeId: string;
  compiledPrompt: string;
  refs: GenerationReference[];
  status: Exclude<NodeStatus, "draft">;
  asset?: string | undefined;
  error?: string | undefined;
  createdAt: string;
  resolvedAt?: string | undefined;
}

export interface Board {
  version: 2;
  id: string;
  title: string;
  styleNote: string;
  nodes: BoardCard[];
  requests: Record<string, GenerationRecord>;
  createdAt: string;
  updatedAt: string;
}

/** Card footprint on the canvas, used for placement and the v1 layout. */
export const CARD_SLOT_WIDTH = 340;
export const CARD_SLOT_HEIGHT = 560;

/**
 * Boards written before the free canvas: a tree whose root is the board
 * itself, with an implicit "parent" reference and explicit cross-branch
 * refLines. Only migration reads this shape.
 */
interface LegacyBoardNode {
  id: string;
  title: string;
  status?: NodeStatus;
  prompt?: string;
  note?: string;
  refs?: Array<{
    order: number;
    source: string;
    usage: string;
    refLineId?: string;
  }>;
  requestId?: string;
  asset?: string;
  error?: string;
  expanded?: boolean;
  children: LegacyBoardNode[];
}

interface LegacyBoard {
  version: 1;
  id: string;
  title: string;
  styleNote: string;
  root: LegacyBoardNode;
  refLines: Array<{ id: string; from: string; to: string }>;
  requests: Record<string, GenerationRecord>;
  createdAt: string;
  updatedAt: string;
}

const safeAssetPath = (value: string): boolean => {
  const normalized = value.replaceAll("\\", "/");
  return (
    normalized.startsWith("assets/") &&
    !path.posix.isAbsolute(normalized) &&
    !normalized.split("/").includes("..")
  );
};

export const BoardIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9-]{0,63}$/u, "Invalid board id");

export const NodeReferenceSchema = z.object({
  order: z.number().int().min(1).max(5),
  source: z.string().trim().min(1),
  usage: z.string().max(2_000).default(""),
});

export const BoardCardSchema: z.ZodType<BoardCard> = z.object({
  id: z.string().trim().min(1).max(128),
  title: z.string().max(200).default(""),
  status: z.enum(NODE_STATUSES).optional(),
  prompt: z.string().max(20_000).optional(),
  note: z.string().max(10_000).optional(),
  refs: z.array(NodeReferenceSchema).max(5).optional(),
  requestId: z.string().trim().min(1).optional(),
  asset: z.string().refine(safeAssetPath, "Asset must be inside assets/").optional(),
  error: z.string().max(10_000).optional(),
  x: z.number().finite(),
  y: z.number().finite(),
});

export const GenerationReferenceSchema = z.object({
  node: z.string().trim().min(1),
  usage: z.string().max(2_000),
  asset: z.string().refine(safeAssetPath, "Asset must be inside assets/"),
});

export const GenerationRecordSchema = z.object({
  nodeId: z.string().trim().min(1),
  compiledPrompt: z.string().min(1),
  refs: z.array(GenerationReferenceSchema).max(5),
  status: z.enum(["queued", "generating", "ready", "error"]),
  asset: z.string().refine(safeAssetPath, "Asset must be inside assets/").optional(),
  error: z.string().max(10_000).optional(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().optional(),
});

export const BoardSchema: z.ZodType<Board> = z.object({
  version: z.literal(2),
  id: BoardIdSchema,
  title: z.string().trim().min(1).max(200),
  styleNote: z.string().max(10_000).default(""),
  nodes: z.array(BoardCardSchema).default([]),
  requests: z.record(z.string(), GenerationRecordSchema).default({}),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const BoardPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    styleNote: z.string().max(10_000).optional(),
    nodes: z.array(BoardCardSchema).optional(),
  })
  .strict();

export type BoardPatch = z.infer<typeof BoardPatchSchema>;

export const RequestReferenceInputSchema = z.object({
  sourceNodeId: z.string().trim().min(1),
  usage: z.string().max(2_000).default(""),
});

export const GenerationRequestInputSchema = z.object({
  prompt: z.string().trim().min(1).max(20_000),
  note: z.string().max(10_000).optional(),
  refs: z.array(RequestReferenceInputSchema).max(5).default([]),
});

export type GenerationRequestInput = z.infer<
  typeof GenerationRequestInputSchema
>;

export function cardsById(board: Board): Map<string, BoardCard> {
  const cards = new Map<string, BoardCard>();
  for (const card of board.nodes) {
    if (cards.has(card.id)) {
      throw new Error(`Duplicate node id: ${card.id}`);
    }
    cards.set(card.id, card);
  }
  return cards;
}

export function findCard(board: Board, nodeId: string): BoardCard | undefined {
  return board.nodes.find((card) => card.id === nodeId);
}

export function normalizeBoard(board: Board): Board {
  const cards = cardsById(board);

  for (const card of cards.values()) {
    const seenSources = new Set<string>();
    const normalizedRefs: NodeReference[] = [];
    const orderedRefs = [...(card.refs ?? [])].sort(
      (a, b) => a.order - b.order,
    );
    for (const reference of orderedRefs) {
      const source = cards.get(reference.source);
      if (
        !source?.asset ||
        source.id === card.id ||
        seenSources.has(source.id)
      ) {
        continue;
      }
      if (normalizedRefs.length >= 5) break;
      normalizedRefs.push({
        order: normalizedRefs.length + 1,
        source: source.id,
        usage: reference.usage,
      });
      seenSources.add(source.id);
    }

    if (normalizedRefs.length) card.refs = normalizedRefs;
    else delete card.refs;
    if (card.requestId && !board.requests[card.requestId]) {
      delete card.requestId;
    }
  }

  board.requests = Object.fromEntries(
    Object.entries(board.requests).filter(([, request]) =>
      cards.has(request.nodeId),
    ),
  );
  return board;
}

export function validateBoard(board: Board): Board {
  const parsed = BoardSchema.parse(board);
  normalizeBoard(parsed);
  const cards = cardsById(parsed);

  for (const [requestId, request] of Object.entries(parsed.requests)) {
    if (!cards.has(request.nodeId)) {
      throw new Error(`Request ${requestId} references missing node`);
    }
    for (const reference of request.refs) {
      if (!cards.has(reference.node)) {
        throw new Error(
          `Request ${requestId} references missing source ${reference.node}`,
        );
      }
    }
  }

  return parsed;
}

/**
 * A v1 board is a tree, so lay it out once as the canvas it becomes: children
 * below their parent, subtrees packed side by side. The tree parent turns into
 * the card's first reference — which is what it always meant.
 */
export function migrateBoardV1(legacy: LegacyBoard): Board {
  const parents = new Map<string, LegacyBoardNode | null>();
  const flat: LegacyBoardNode[] = [];
  const visit = (node: LegacyBoardNode, parent: LegacyBoardNode | null) => {
    parents.set(node.id, parent);
    if (parent) flat.push(node);
    node.children.forEach((child) => visit(child, node));
  };
  visit(legacy.root, null);

  const slots = new Map<string, number>();
  const subtreeSlots = (node: LegacyBoardNode): number => {
    const width = node.children.length
      ? node.children.reduce((sum, child) => sum + subtreeSlots(child), 0)
      : 1;
    slots.set(node.id, width);
    return width;
  };
  subtreeSlots(legacy.root);

  const positions = new Map<string, { x: number; y: number }>();
  const layout = (node: LegacyBoardNode, left: number, depth: number) => {
    const width = slots.get(node.id) ?? 1;
    positions.set(node.id, {
      x: (left + width / 2 - 0.5) * CARD_SLOT_WIDTH,
      y: depth * CARD_SLOT_HEIGHT,
    });
    let childLeft = left;
    for (const child of node.children) {
      layout(child, childLeft, depth + 1);
      childLeft += slots.get(child.id) ?? 1;
    }
  };
  // The root card disappears, so its children start at depth 0.
  let rootChildLeft = 0;
  for (const child of legacy.root.children) {
    layout(child, rootChildLeft, 0);
    rootChildLeft += slots.get(child.id) ?? 1;
  }

  const nodes: BoardCard[] = flat.map((node) => {
    const position = positions.get(node.id) ?? { x: 0, y: 0 };
    const parent = parents.get(node.id);
    const refs = (node.refs ?? [])
      .map((reference) => ({
        order: reference.order,
        source:
          reference.source === "parent" ? (parent?.id ?? "") : reference.source,
        usage: reference.usage,
      }))
      .filter((reference) => reference.source && reference.source !== "root");
    return {
      id: node.id,
      title: node.title,
      ...(node.status === undefined ? {} : { status: node.status }),
      ...(node.prompt === undefined ? {} : { prompt: node.prompt }),
      ...(node.note === undefined ? {} : { note: node.note }),
      ...(refs.length ? { refs } : {}),
      ...(node.requestId === undefined ? {} : { requestId: node.requestId }),
      ...(node.asset === undefined ? {} : { asset: node.asset }),
      ...(node.error === undefined ? {} : { error: node.error }),
      x: position.x,
      y: position.y,
    };
  });

  return {
    version: 2,
    id: legacy.id,
    title: legacy.title,
    styleNote: legacy.styleNote,
    nodes,
    requests: legacy.requests,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
  };
}

/** Parse a stored board of any known version into the current shape. */
export function parseStoredBoard(raw: unknown): Board {
  const versioned = raw as { version?: unknown };
  if (versioned?.version === 1) {
    return validateBoard(migrateBoardV1(raw as LegacyBoard));
  }
  return validateBoard(raw as Board);
}

/**
 * Pick a spot for a card the server has to place itself — an import the
 * canvas did not position. Derived cards go below their primary source, the
 * way generations grow; sourceless cards line up along the top. Slide right
 * until the slot is free.
 */
export function placeCard(
  nodes: readonly BoardCard[],
  primary?: BoardCard,
): { x: number; y: number } {
  const start = primary
    ? { x: primary.x, y: primary.y + CARD_SLOT_HEIGHT }
    : {
        x: nodes.length
          ? Math.max(...nodes.map((card) => card.x)) + CARD_SLOT_WIDTH
          : 0,
        y: nodes.length ? Math.min(...nodes.map((card) => card.y)) : 0,
      };
  const occupied = (x: number, y: number): boolean =>
    nodes.some(
      (card) =>
        Math.abs(card.x - x) < CARD_SLOT_WIDTH - 20 &&
        Math.abs(card.y - y) < CARD_SLOT_HEIGHT - 20,
    );
  let { x } = start;
  while (occupied(x, start.y)) x += CARD_SLOT_WIDTH;
  return { x, y: start.y };
}

export function createEmptyBoard(
  id: string,
  title: string,
  now = new Date().toISOString(),
): Board {
  return {
    version: 2,
    id: BoardIdSchema.parse(id),
    title,
    styleNote: "",
    nodes: [],
    requests: {},
    createdAt: now,
    updatedAt: now,
  };
}
