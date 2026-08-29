import { describe, expect, it } from "vitest";
import { buildGenerationInput } from "./compile.js";
import type { Board } from "./model.js";

function boardFixture(): Board {
  return {
    version: 2,
    id: "board-ui",
    title: "UI",
    styleNote: "",
    nodes: [
      {
        id: "parent",
        title: "Parent",
        status: "ready",
        asset: "assets/parent.png",
        x: 0,
        y: 0,
      },
      {
        id: "source",
        title: "Source",
        status: "ready",
        asset: "assets/source.png",
        x: 340,
        y: 0,
      },
      {
        id: "target",
        title: "Target",
        status: "draft",
        prompt: "Combine",
        note: "Keep detail",
        refs: [
          { order: 1, source: "parent", usage: "body" },
          { order: 2, source: "source", usage: "palette" },
        ],
        x: 0,
        y: 560,
      },
    ],
    requests: {},
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("UI generation input", () => {
  it("preserves reference numbering", () => {
    const request = buildGenerationInput(boardFixture(), "target");
    expect(request).toEqual({
      prompt: "Combine",
      note: "Keep detail",
      refs: [
        { sourceNodeId: "parent", usage: "body" },
        { sourceNodeId: "source", usage: "palette" },
      ],
    });
  });

  it("requires a non-empty prompt", () => {
    const board = boardFixture();
    board.nodes.find((card) => card.id === "target")!.prompt = " ";
    expect(() => buildGenerationInput(board, "target")).toThrow(
      "请先填写生成提示词",
    );
  });

  it("rejects more than five references", () => {
    const board = boardFixture();
    const target = board.nodes.find((card) => card.id === "target")!;
    for (let index = 2; index <= 5; index += 1) {
      const id = `source-${index}`;
      board.nodes.push({
        id,
        title: id,
        status: "ready",
        asset: `assets/${id}.png`,
        x: 340 * index,
        y: 0,
      });
      target.refs!.push({
        order: index + 1,
        source: id,
        usage: "",
      });
    }
    expect(() => buildGenerationInput(board, "target")).toThrow(
      "单次生成最多使用 5 张参考图",
    );
  });
});
