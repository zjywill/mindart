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
  refLineId?: string | undefined;
}

export interface BoardNode {
  id: string;
  title: string;
  status?: NodeStatus | undefined;
  prompt?: string | undefined;
  note?: string | undefined;
  refs?: NodeReference[] | undefined;
  requestId?: string | undefined;
  asset?: string | undefined;
  error?: string | undefined;
  expanded?: boolean | undefined;
  children: BoardNode[];
}

export interface ReferenceLine {
  id: string;
  from: string;
  to: string;
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
  version: 1;
  id: string;
  title: string;
  styleNote: string;
  root: BoardNode;
  refLines: ReferenceLine[];
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
  refLineId: z.string().trim().min(1).optional(),
});

export const BoardNodeSchema: z.ZodType<BoardNode> = z.lazy(() =>
  z.object({
    id: z.string().trim().min(1).max(128),
    title: z.string().max(200).default(""),
    status: z.enum(NODE_STATUSES).optional(),
    prompt: z.string().max(20_000).optional(),
    note: z.string().max(10_000).optional(),
    refs: z.array(NodeReferenceSchema).max(5).optional(),
    requestId: z.string().trim().min(1).optional(),
    asset: z.string().refine(safeAssetPath, "Asset must be inside assets/").optional(),
    error: z.string().max(10_000).optional(),
    expanded: z.boolean().optional(),
    children: z.array(BoardNodeSchema).default([]),
  }),
);

export const ReferenceLineSchema = z.object({
  id: z.string().trim().min(1),
  from: z.string().trim().min(1),
  to: z.string().trim().min(1),
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
  version: z.literal(1),
  id: BoardIdSchema,
  title: z.string().trim().min(1).max(200),
  styleNote: z.string().max(10_000).default(""),
  root: BoardNodeSchema,
  refLines: z.array(ReferenceLineSchema).default([]),
  requests: z.record(z.string(), GenerationRecordSchema).default({}),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const BoardPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    styleNote: z.string().max(10_000).optional(),
    root: BoardNodeSchema.optional(),
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

export interface NodeLocation {
  node: BoardNode;
  parent: BoardNode | null;
}

export function flattenBoard(root: BoardNode): Map<string, NodeLocation> {
  const nodes = new Map<string, NodeLocation>();
  const visit = (node: BoardNode, parent: BoardNode | null): void => {
    if (nodes.has(node.id)) {
      throw new Error(`Duplicate node id: ${node.id}`);
    }
    nodes.set(node.id, { node, parent });
    for (const child of node.children) {
      visit(child, node);
    }
  };
  visit(root, null);
  return nodes;
}

export function normalizeBoard(board: Board): Board {
  const nodes = flattenBoard(board.root);
  const validRequests = Object.fromEntries(
    Object.entries(board.requests).filter(([, request]) =>
      nodes.has(request.nodeId),
    ),
  );

  for (const { node, parent } of nodes.values()) {
    if (!parent) {
      node.refs = [];
      continue;
    }

    const seenSources = new Set<string>();
    const normalizedRefs: NodeReference[] = [];
    const parentRef = node.refs?.find(
      (reference) => reference.order === 1 || reference.source === "parent",
    );

    if (parent.asset) {
      normalizedRefs.push({
        order: 1,
        source: "parent",
        usage: parentRef?.usage ?? "",
      });
      seenSources.add(parent.id);
    }

    for (const reference of node.refs ?? []) {
      if (reference.source === "parent") continue;
      const source = nodes.get(reference.source)?.node;
      if (!source?.asset || source.id === node.id || seenSources.has(source.id)) {
        continue;
      }
      if (normalizedRefs.length >= 5) break;
      normalizedRefs.push({
        order: normalizedRefs.length + 1,
        source: source.id,
        usage: reference.usage,
        refLineId: reference.refLineId ?? `ref-${source.id}-${node.id}`,
      });
      seenSources.add(source.id);
    }

    node.refs = normalizedRefs;
    if (node.requestId && !validRequests[node.requestId]) {
      delete node.requestId;
    }
  }

  const refLines: ReferenceLine[] = [];
  for (const { node } of nodes.values()) {
    for (const reference of node.refs ?? []) {
      if (reference.source === "parent") continue;
      const id = reference.refLineId ?? `ref-${reference.source}-${node.id}`;
      reference.refLineId = id;
      refLines.push({ id, from: reference.source, to: node.id });
    }
  }

  board.refLines = refLines;
  board.requests = validRequests;
  return board;
}

export function validateBoard(board: Board): Board {
  const parsed = BoardSchema.parse(board);
  normalizeBoard(parsed);
  const nodes = flattenBoard(parsed.root);

  for (const [requestId, request] of Object.entries(parsed.requests)) {
    const node = nodes.get(request.nodeId)?.node;
    if (!node) {
      throw new Error(`Request ${requestId} references missing node`);
    }
    for (const reference of request.refs) {
      if (!nodes.has(reference.node)) {
        throw new Error(
          `Request ${requestId} references missing source ${reference.node}`,
        );
      }
    }
  }

  return parsed;
}

export function createEmptyBoard(
  id: string,
  title: string,
  now = new Date().toISOString(),
): Board {
  return {
    version: 1,
    id: BoardIdSchema.parse(id),
    title,
    styleNote: "",
    root: {
      id: "root",
      title,
      expanded: true,
      children: [],
    },
    refLines: [],
    requests: {},
    createdAt: now,
    updatedAt: now,
  };
}
