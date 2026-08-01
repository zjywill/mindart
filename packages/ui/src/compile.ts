import {
  findNode,
  referencesForNode,
  type Board,
  type GenerationRequestInput,
} from "./model.js";

export function buildGenerationInput(
  board: Board,
  nodeId: string,
): GenerationRequestInput {
  const location = findNode(board, nodeId);
  if (!location) throw new Error("未找到目标图卡");
  const prompt = location.node.prompt?.trim();
  if (!prompt) throw new Error("请先填写生成提示词");

  const refs = referencesForNode(board, location.node);
  if (refs.length > 5) throw new Error("单次生成最多使用 5 张参考图");
  if (refs.some(({ sourceNode }) => !sourceNode.asset)) {
    throw new Error("参考图尚未就绪");
  }

  return {
    prompt,
    ...(location.node.note === undefined ? {} : { note: location.node.note }),
    refs: refs.map(({ sourceNode, reference }) => ({
      sourceNodeId: sourceNode.id,
      usage: reference.usage,
    })),
  };
}
