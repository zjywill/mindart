import {
  findCard,
  referencesForCard,
  type Board,
  type GenerationRequestInput,
} from "./model.js";

export function buildGenerationInput(
  board: Board,
  nodeId: string,
): GenerationRequestInput {
  const card = findCard(board, nodeId);
  if (!card) throw new Error("未找到目标图卡");
  const prompt = card.prompt?.trim();
  if (!prompt) throw new Error("请先填写生成提示词");

  const refs = referencesForCard(board, card);
  if (refs.length > 5) throw new Error("单次生成最多使用 5 张参考图");
  if (refs.some(({ sourceCard }) => !sourceCard.asset)) {
    throw new Error("参考图尚未就绪");
  }

  return {
    prompt,
    ...(card.note === undefined ? {} : { note: card.note }),
    refs: refs.map(({ sourceCard, reference }) => ({
      sourceNodeId: sourceCard.id,
      usage: reference.usage,
    })),
  };
}
