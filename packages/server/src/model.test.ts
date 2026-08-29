import { describe, expect, it } from "vitest";
import {
  CARD_SLOT_HEIGHT,
  CARD_SLOT_WIDTH,
  createEmptyBoard,
  normalizeBoard,
  parseStoredBoard,
  placeCard,
  validateBoard,
} from "./model.js";

describe("board model", () => {
  it("normalizes references into stable order and drops broken ones", () => {
    const board = createEmptyBoard("board-model", "Model");
    board.nodes = [
      { id: "parent", title: "Parent", status: "ready", asset: "assets/parent.png", x: 0, y: 0 },
      { id: "source", title: "Source", status: "ready", asset: "assets/source.png", x: 340, y: 0 },
      { id: "bare", title: "Bare", status: "draft", x: 680, y: 0 },
      {
        id: "target",
        title: "Target",
        status: "draft",
        refs: [
          { order: 3, source: "source", usage: "palette" },
          { order: 2, source: "parent", usage: "shape" },
          { order: 4, source: "source", usage: "duplicate" },
          { order: 5, source: "bare", usage: "no image yet" },
          { order: 6, source: "missing", usage: "not on the board" },
        ],
        x: 0,
        y: 560,
      },
    ];

    normalizeBoard(board);
    const target = board.nodes.find((card) => card.id === "target")!;

    expect(target.refs).toEqual([
      { order: 1, source: "parent", usage: "shape" },
      { order: 2, source: "source", usage: "palette" },
    ]);
  });

  it("rejects assets outside the board assets directory", () => {
    const board = createEmptyBoard("board-path", "Path");
    board.nodes.push({
      id: "bad",
      title: "Bad",
      status: "ready",
      asset: "../secret.png",
      x: 0,
      y: 0,
    });

    expect(() => validateBoard(board)).toThrow(
      "Asset must be inside assets/",
    );
  });

  it("rejects duplicate node ids", () => {
    const board = createEmptyBoard("board-duplicate", "Duplicate");
    board.nodes = [
      { id: "same", title: "A", x: 0, y: 0 },
      { id: "same", title: "B", x: 340, y: 0 },
    ];

    expect(() => validateBoard(board)).toThrow("Duplicate node id");
  });

  it("migrates a v1 tree into positioned cards with explicit references", () => {
    const board = parseStoredBoard({
      version: 1,
      id: "board-legacy",
      title: "Legacy",
      styleNote: "style",
      root: {
        id: "root",
        title: "Legacy",
        expanded: true,
        children: [
          {
            id: "body",
            title: "Body",
            status: "ready",
            asset: "assets/body.png",
            expanded: true,
            children: [
              {
                id: "result",
                title: "Result",
                status: "draft",
                prompt: "combine",
                refs: [
                  { order: 1, source: "parent", usage: "体型" },
                  {
                    order: 2,
                    source: "palette",
                    usage: "配色",
                    refLineId: "ref-palette-result",
                  },
                ],
                children: [],
              },
            ],
          },
          {
            id: "palette",
            title: "Palette",
            status: "ready",
            asset: "assets/palette.png",
            expanded: true,
            children: [],
          },
        ],
      },
      refLines: [{ id: "ref-palette-result", from: "palette", to: "result" }],
      requests: {},
      createdAt: "2026-08-01T08:00:00.000Z",
      updatedAt: "2026-08-01T08:01:00.000Z",
    });

    expect(board.version).toBe(2);
    expect(board.nodes.map((card) => card.id)).toEqual([
      "body",
      "result",
      "palette",
    ]);

    const result = board.nodes.find((card) => card.id === "result")!;
    // The implicit tree parent becomes an explicit first reference.
    expect(result.refs).toEqual([
      { order: 1, source: "body", usage: "体型" },
      { order: 2, source: "palette", usage: "配色" },
    ]);

    const body = board.nodes.find((card) => card.id === "body")!;
    const palette = board.nodes.find((card) => card.id === "palette")!;
    // Children of the old root sit on the top row; a child sits one row below
    // its parent, and sibling subtrees do not overlap.
    expect(body.y).toBe(0);
    expect(palette.y).toBe(0);
    expect(result.y).toBe(CARD_SLOT_HEIGHT);
    expect(body.x).not.toBe(palette.x);
  });

  it("places a derived card below its source and slides right past occupied slots", () => {
    const source = { id: "a", title: "A", x: 0, y: 0 };
    const below = { id: "b", title: "B", x: 0, y: CARD_SLOT_HEIGHT };
    expect(placeCard([source], source)).toEqual({
      x: 0,
      y: CARD_SLOT_HEIGHT,
    });
    expect(placeCard([source, below], source)).toEqual({
      x: CARD_SLOT_WIDTH,
      y: CARD_SLOT_HEIGHT,
    });
    // Sourceless cards line up along the top row.
    expect(placeCard([source, below])).toEqual({ x: CARD_SLOT_WIDTH, y: 0 });
  });
});
