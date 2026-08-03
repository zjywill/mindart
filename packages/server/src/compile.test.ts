import path from "node:path";
import { describe, expect, it } from "vitest";
import { compileGenerationRequest } from "./compile.js";
import { createEmptyBoard } from "./model.js";

describe("generation compiler", () => {
  it("compiles numbered images, usage notes, board style, and card note", () => {
    const board = createEmptyBoard("board-compile", "Compile");
    board.styleNote = "棚拍，低饱和";
    board.root.children = [
      {
        id: "parent",
        title: "Body",
        status: "ready",
        asset: "assets/body.png",
        children: [
          {
            id: "target",
            title: "Result",
            status: "draft",
            prompt: "组合成一个新角色",
            note: "保留破损斗篷",
            refs: [
              { order: 1, source: "parent", usage: "体型" },
              {
                order: 2,
                source: "palette",
                usage: "绿色配色",
                refLineId: "ref-palette-target",
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
        children: [],
      },
    ];

    const directory = "/tmp/mindart/board-compile";
    const result = compileGenerationRequest(
      board,
      "target",
      directory,
      "req-test",
    );

    expect(result.refs).toHaveLength(2);
    expect(result.compiledPrompt).toContain(
      `参考图 1：${path.resolve(directory, "assets/body.png")}`,
    );
    expect(result.compiledPrompt).toContain("取用说明：绿色配色");
    expect(result.compiledPrompt).toContain("风格设定（画板级）：棚拍，低饱和");
    expect(result.compiledPrompt).toContain("本卡备注：保留破损斗篷");
    expect(result.compiledPrompt).toContain(
      'mindart_apply_result(request_id="req-test"',
    );
  });

  it("tells the host to feed reference images as images, not as text", () => {
    const board = createEmptyBoard("board-refs", "Refs");
    board.root.children = [
      {
        id: "parent",
        title: "Parent",
        status: "ready",
        asset: "assets/parent.png",
        children: [
          {
            id: "target",
            title: "Result",
            status: "draft",
            prompt: "换个场景",
            refs: [{ order: 1, source: "parent", usage: "主体" }],
            children: [],
          },
        ],
      },
    ];

    const result = compileGenerationRequest(
      board,
      "target",
      "/tmp/mindart/board-refs",
      "req-refs",
    );

    expect(result.compiledPrompt).toContain("逐张输入出图模型");
    expect(result.compiledPrompt).toContain("不得先改写成文字描述再生成");
    expect(result.compiledPrompt).toContain("不要静默丢弃任何一张");
    expect(result.compiledPrompt).toContain("mindart_report_error");
  });

  it("omits the reference-image rules when a card has no references", () => {
    const board = createEmptyBoard("board-no-refs", "No refs");
    board.root.children.push({
      id: "target",
      title: "Target",
      status: "draft",
      prompt: "从零画一张",
      children: [],
    });

    const result = compileGenerationRequest(
      board,
      "target",
      "/tmp/mindart/board-no-refs",
      "req-no-refs",
    );

    expect(result.refs).toHaveLength(0);
    expect(result.compiledPrompt).not.toContain("参考图用法");
  });

  it("requires a prompt", () => {
    const board = createEmptyBoard("board-empty-prompt", "Empty");
    board.root.children.push({
      id: "target",
      title: "Target",
      status: "draft",
      children: [],
    });

    expect(() =>
      compileGenerationRequest(board, "target", "/tmp/board", "req-empty"),
    ).toThrow("Generation prompt is required");
  });
});
