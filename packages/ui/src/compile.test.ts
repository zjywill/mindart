import { describe, expect, it } from "vitest";
import { buildGenerationInput } from "./compile.js";
import type { Board } from "./model.js";

function boardFixture(): Board {
  return {
    version: 1,
    id: "board-ui",
    title: "UI",
    styleNote: "",
    root: {
      id: "root",
      title: "UI",
      children: [
        {
          id: "parent",
          title: "Parent",
          status: "ready",
          asset: "assets/parent.png",
          children: [
            {
              id: "target",
              title: "Target",
              status: "draft",
              prompt: "Combine",
              note: "Keep detail",
              refs: [
                { order: 1, source: "parent", usage: "body" },
                {
                  order: 2,
                  source: "source",
                  usage: "palette",
                  refLineId: "ref-source-target",
                },
              ],
              children: [],
            },
          ],
        },
        {
          id: "source",
          title: "Source",
          status: "ready",
          asset: "assets/source.png",
          children: [],
        },
      ],
    },
    refLines: [{ id: "ref-source-target", from: "source", to: "target" }],
    requests: {},
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
  };
}

describe("UI generation input", () => {
  it("preserves parent-first reference numbering", () => {
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
    board.root.children[0]!.children[0]!.prompt = " ";
    expect(() => buildGenerationInput(board, "target")).toThrow(
      "请先填写生成提示词",
    );
  });

  it("rejects more than five references", () => {
    const board = boardFixture();
    const target = board.root.children[0]!.children[0]!;
    for (let index = 2; index <= 5; index += 1) {
      const id = `source-${index}`;
      board.root.children.push({
        id,
        title: id,
        status: "ready",
        asset: `assets/${id}.png`,
        children: [],
      });
      target.refs!.push({
        order: index + 1,
        source: id,
        usage: "",
        refLineId: `ref-${id}-target`,
      });
    }
    expect(() => buildGenerationInput(board, "target")).toThrow(
      "单次生成最多使用 5 张参考图",
    );
  });
});
