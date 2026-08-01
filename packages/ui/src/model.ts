export type NodeStatus =
  | "draft"
  | "queued"
  | "generating"
  | "ready"
  | "error";

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

export interface RequestReferenceInput {
  sourceNodeId: string;
  usage: string;
}

export interface GenerationRequestInput {
  prompt: string;
  note?: string | undefined;
  refs: RequestReferenceInput[];
}

export interface NodeLocation {
  node: BoardNode;
  parent: BoardNode | null;
}

export function flattenBoard(root: BoardNode): Map<string, NodeLocation> {
  const nodes = new Map<string, NodeLocation>();
  const visit = (node: BoardNode, parent: BoardNode | null): void => {
    nodes.set(node.id, { node, parent });
    node.children.forEach((child) => visit(child, node));
  };
  visit(root, null);
  return nodes;
}

export function cloneBoard(board: Board): Board {
  return structuredClone(board);
}

export function findNode(board: Board, nodeId: string): NodeLocation | undefined {
  return flattenBoard(board.root).get(nodeId);
}

export function referencesForNode(
  board: Board,
  node: BoardNode,
): Array<{ sourceNode: BoardNode; reference: NodeReference }> {
  const nodes = flattenBoard(board.root);
  const parent = nodes.get(node.id)?.parent;
  const output: Array<{ sourceNode: BoardNode; reference: NodeReference }> = [];

  for (const reference of node.refs ?? []) {
    const sourceNode =
      reference.source === "parent"
        ? parent
        : nodes.get(reference.source)?.node;
    if (sourceNode) output.push({ sourceNode, reference });
  }
  return output;
}

export function normalizeClientBoard(board: Board): Board {
  const nodes = flattenBoard(board.root);
  const validIds = new Set(nodes.keys());

  for (const { node, parent } of nodes.values()) {
    if (!parent) {
      node.refs = [];
      continue;
    }

    const refs: NodeReference[] = [];
    const seen = new Set<string>();
    const oldParent = node.refs?.find(
      (reference) => reference.source === "parent" || reference.order === 1,
    );
    if (parent.asset) {
      refs.push({
        order: 1,
        source: "parent",
        usage: oldParent?.usage ?? "",
      });
      seen.add(parent.id);
    }

    for (const reference of node.refs ?? []) {
      if (
        reference.source === "parent" ||
        !validIds.has(reference.source) ||
        seen.has(reference.source) ||
        refs.length >= 5
      ) {
        continue;
      }
      const source = nodes.get(reference.source)?.node;
      if (!source?.asset || source.id === node.id) continue;
      refs.push({
        order: refs.length + 1,
        source: source.id,
        usage: reference.usage,
        refLineId: reference.refLineId ?? `ref-${source.id}-${node.id}`,
      });
      seen.add(source.id);
    }
    node.refs = refs;
  }

  board.refLines = [];
  for (const { node } of nodes.values()) {
    for (const reference of node.refs ?? []) {
      if (reference.source === "parent") continue;
      const id = reference.refLineId ?? `ref-${reference.source}-${node.id}`;
      reference.refLineId = id;
      board.refLines.push({ id, from: reference.source, to: node.id });
    }
  }

  board.requests = Object.fromEntries(
    Object.entries(board.requests).filter(([, request]) =>
      validIds.has(request.nodeId),
    ),
  );
  return board;
}
