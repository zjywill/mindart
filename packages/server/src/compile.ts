import path from "node:path";
import type { Board, GenerationReference } from "./model.js";
import { cardsById } from "./model.js";

export interface CompiledGeneration {
  compiledPrompt: string;
  refs: GenerationReference[];
}

export function compileGenerationRequest(
  board: Board,
  nodeId: string,
  boardDirectory: string,
  requestId: string,
): CompiledGeneration {
  const cards = cardsById(board);
  const card = cards.get(nodeId);
  if (!card) throw new Error(`Node not found: ${nodeId}`);

  const prompt = card.prompt?.trim();
  if (!prompt) throw new Error("Generation prompt is required");

  const nodeRefs = card.refs ?? [];
  if (nodeRefs.length > 5) {
    throw new Error("A generation can use at most 5 reference images");
  }

  const refs = nodeRefs.map((reference) => {
    const sourceCard = cards.get(reference.source);
    if (!sourceCard?.asset) {
      throw new Error(`Reference ${reference.source} has no image asset`);
    }
    return {
      node: sourceCard.id,
      usage: reference.usage,
      asset: sourceCard.asset,
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
  if (card.note?.trim()) {
    lines.push(`本卡备注：${card.note.trim()}`);
  }

  if (refs.length > 0) {
    lines.push(
      "参考图用法：必须把上列图片文件本身逐张输入出图模型，传入顺序与编号一致；不得先改写成文字描述再生成。",
      "若出图模型接不下全部参考图，先向用户说明并确认取舍，不要静默丢弃任何一张；确实无法完成时调用 mindart_report_error。",
    );
  }

  lines.push(
    `产出要求：完成后调用 mindart_apply_result(request_id="${requestId}", image_path=...)。不要只把图片贴在对话里。`,
  );

  return {
    compiledPrompt: lines.join("\n"),
    refs,
  };
}
