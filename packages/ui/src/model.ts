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

export interface RequestReferenceInput {
  sourceNodeId: string;
  usage: string;
}

export interface GenerationRequestInput {
  prompt: string;
  note?: string | undefined;
  refs: RequestReferenceInput[];
}

export function cardsById(board: Board): Map<string, BoardCard> {
  return new Map(board.nodes.map((card) => [card.id, card]));
}

export function cloneBoard(board: Board): Board {
  return structuredClone(board);
}

export function findCard(board: Board, nodeId: string): BoardCard | undefined {
  return board.nodes.find((card) => card.id === nodeId);
}

export function referencesForCard(
  board: Board,
  card: BoardCard,
): Array<{ sourceCard: BoardCard; reference: NodeReference }> {
  const cards = cardsById(board);
  const output: Array<{ sourceCard: BoardCard; reference: NodeReference }> = [];
  for (const reference of card.refs ?? []) {
    const sourceCard = cards.get(reference.source);
    if (sourceCard) output.push({ sourceCard, reference });
  }
  return output;
}

/**
 * The cards a given card was made from, then the cards made from those,
 * all the way up. Used to light up a lineage on the canvas. References can
 * in principle loop, so walk with a visited set.
 */
export function lineageOf(board: Board, nodeId: string): Set<string> {
  const cards = cardsById(board);
  const lineage = new Set<string>([nodeId]);

  const walkUp = (id: string): void => {
    for (const reference of cards.get(id)?.refs ?? []) {
      if (lineage.has(reference.source)) continue;
      lineage.add(reference.source);
      walkUp(reference.source);
    }
  };
  const walkDown = (id: string): void => {
    for (const card of board.nodes) {
      if (lineage.has(card.id)) continue;
      if ((card.refs ?? []).some((reference) => reference.source === id)) {
        lineage.add(card.id);
        walkDown(card.id);
      }
    }
  };
  walkUp(nodeId);
  walkDown(nodeId);
  return lineage;
}

export function normalizeClientBoard(board: Board): Board {
  const cards = cardsById(board);

  for (const card of board.nodes) {
    const seen = new Set<string>();
    const refs: NodeReference[] = [];
    const ordered = [...(card.refs ?? [])].sort((a, b) => a.order - b.order);
    for (const reference of ordered) {
      const source = cards.get(reference.source);
      if (!source?.asset || source.id === card.id || seen.has(source.id)) {
        continue;
      }
      if (refs.length >= 5) break;
      refs.push({
        order: refs.length + 1,
        source: source.id,
        usage: reference.usage,
      });
      seen.add(source.id);
    }
    if (refs.length) card.refs = refs;
    else delete card.refs;
  }

  board.requests = Object.fromEntries(
    Object.entries(board.requests).filter(([, request]) =>
      cards.has(request.nodeId),
    ),
  );
  return board;
}
