import { describe, expect, it } from "vitest";
import {
  createEmptyBoard,
  normalizeBoard,
  validateBoard,
  type BoardNode,
} from "./model.js";

describe("board model", () => {
  it("normalizes parent and cross-branch references into stable order", () => {
    const board = createEmptyBoard("board-model", "Model");
    const parent: BoardNode = {
      id: "parent",
      title: "Parent",
      status: "ready",
      asset: "assets/parent.png",
      children: [
        {
          id: "target",
          title: "Target",
          status: "draft",
          refs: [
            { order: 4, source: "source", usage: "palette" },
            { order: 2, source: "parent", usage: "shape" },
            { order: 3, source: "source", usage: "duplicate" },
          ],
          children: [],
        },
      ],
    };
    board.root.children = [
      parent,
      {
        id: "source",
        title: "Source",
        status: "ready",
        asset: "assets/source.png",
        children: [],
      },
    ];

    normalizeBoard(board);
    const target = parent.children[0]!;

    expect(target.refs).toEqual([
      { order: 1, source: "parent", usage: "shape" },
      {
        order: 2,
        source: "source",
        usage: "palette",
        refLineId: "ref-source-target",
      },
    ]);
    expect(board.refLines).toEqual([
      { id: "ref-source-target", from: "source", to: "target" },
    ]);
  });

  it("rejects assets outside the board assets directory", () => {
    const board = createEmptyBoard("board-path", "Path");
    board.root.children.push({
      id: "bad",
      title: "Bad",
      status: "ready",
      asset: "../secret.png",
      children: [],
    });

    expect(() => validateBoard(board)).toThrow(
      "Asset must be inside assets/",
    );
  });

  it("rejects duplicate node ids", () => {
    const board = createEmptyBoard("board-duplicate", "Duplicate");
    board.root.children = [
      { id: "same", title: "A", children: [] },
      { id: "same", title: "B", children: [] },
    ];

    expect(() => validateBoard(board)).toThrow("Duplicate node id");
  });
});
