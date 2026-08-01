import path from "node:path";
import type {
  Board,
  BoardNode,
  GenerationReference,
  NodeReference,
} from "./model.js";
import { flattenBoard } from "./model.js";

export interface CompiledGeneration {
  compiledPrompt: string;
  refs: GenerationReference[];
}

function resolveReferenceNodeId(
  node: BoardNode,
  parent: BoardNode | null,
  reference: NodeReference,
): string {
  if (reference.source === "parent") {
    if (!parent) {
      throw new Error(`Node ${node.id} has a parent reference without a parent`);
    }
    return parent.id;
  }
  return reference.source;
}

export function compileGenerationRequest(
  board: Board,
  nodeId: string,
  boardDirectory: string,
  requestId: string,
): CompiledGeneration {
  const nodes = flattenBoard(board.root);
  const location = nodes.get(nodeId);
  if (!location) throw new Error(`Node not found: ${nodeId}`);

  const prompt = location.node.prompt?.trim();
  if (!prompt) throw new Error("Generation prompt is required");

  const nodeRefs = location.node.refs ?? [];
  if (nodeRefs.length > 5) {
    throw new Error("A generation can use at most 5 reference images");
  }

  const refs = nodeRefs.map((reference) => {
    const sourceNodeId = resolveReferenceNodeId(
      location.node,
      location.parent,
      reference,
    );
    const sourceNode = nodes.get(sourceNodeId)?.node;
    if (!sourceNode?.asset) {
      throw new Error(`Reference ${sourceNodeId} has no image asset`);
    }
    return {
      node: sourceNodeId,
      usage: reference.usage,
      asset: sourceNode.asset,
    };
  });

  const lines = [
    "请生成一张图片。",
    `结合指令（目标卡提示词）：${prompt}`,
  ];

  refs.forEach((reference, index) => {
    lines.push(
      `参考图 ${index + 1}：${path.resolve(boardDirectory, reference.asset)}`,
      `  取用说明：${reference.usage}`,
    );
  });

  if (board.styleNote.trim()) {
    lines.push(`风格设定（画板级）：${board.styleNote.trim()}`);
  }
  if (location.node.note?.trim()) {
    lines.push(`本卡备注：${location.node.note.trim()}`);
  }

  lines.push(
    `产出要求：完成后调用 mindart_apply_result(request_id="${requestId}", image_path=...)。不要只把图片贴在对话里。`,
  );

  return {
    compiledPrompt: lines.join("\n"),
    refs,
  };
}
